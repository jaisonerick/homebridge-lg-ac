import {Logger, PlatformConfig} from 'homebridge';
import {API} from './API';
import {LGAcHomebridgePlatform} from '../platform';
import {Device} from './Device';
import * as uuid from 'uuid';
import * as Path from 'path';
import * as forge from 'node-forge';
import {DeviceModel} from './DeviceModel';
import {PLUGIN_NAME} from '../settings';
import {device as awsIotDevice} from 'aws-iot-device-sdk';
import {URL} from 'url';
import Persist from './Persist';

export type WorkId = typeof uuid['v4'];

export class ThinQ {
  protected api: API;
  protected deviceModel: Record<string, DeviceModel> = {};
  protected persist;
  constructor(
    public readonly platform: LGAcHomebridgePlatform,
    public readonly config: PlatformConfig,
    public readonly log: Logger,
  ) {
    this.api = new API(this.config.country, this.config.language);
    this.api.logger = log;
    this.api.httpClient.interceptors.response.use(response => {
      this.log.debug('[request]', response.config.method, response.config.url);
      return response;
    }, err => {
      return Promise.reject(err);
    });

    if (config.refresh_token) {
      this.api.setRefreshToken(config.refresh_token);
    } else if (config.username && config.password) {
      this.api.setUsernamePassword(config.username, config.password);
    }

    this.persist = new Persist(Path.join(this.platform.api.user.storagePath(), PLUGIN_NAME, 'persist', 'devices'));
  }

  public async devices() {
    const listDevices = await this.api.getListDevices().catch(() => {
      return [];
    });

    return listDevices.map(dev => new Device(dev));
  }

  public async setup(device: Device) {
    // load device model
    device.deviceModel = await this.loadDeviceModel(device);

    if (device.deviceModel.data.Monitoring === undefined
      && device.deviceModel.data.MonitoringValue === undefined
      && device.deviceModel.data.Value === undefined) {
      this.log.warn('['+device.name+'] This device may not "smart" device. Ignore it!');
    }

    return true;
  }

  protected async loadDeviceModel(device: Device) {
    let deviceModel = await this.persist.getItem(device.id);
    if (!deviceModel) {
      this.log.debug('[' + device.id + '] Device model cache missed.');
      deviceModel = await this.api.httpClient.get(device.data.modelJsonUri).then(res => res.data);
      await this.persist.setItem(device.id, deviceModel);
    }

    return this.deviceModel[device.id] = device.deviceModel = new DeviceModel(deviceModel);
  }

  public deviceControl(device: string | Device, values: Record<string, any>, command: 'Set' | 'Operation' = 'Set', ctrlKey = 'basicCtrl') {
    const id = device instanceof Device ? device.id : device;
    return this.api.sendCommandToDevice(id, values, command, ctrlKey).catch(err => {
      // submitted same value
      if (err.response?.data?.resultCode === '0103') {
        return false;
      }

      this.log.error('Unknown Error: ', err.response);
    });
  }

  public async registerMQTTListener(callback: (data: any) => void) {
    const delayMs = ms => new Promise(res => setTimeout(res, ms));

    let tried = 5;
    while(tried > 0) {
      try {
        await this._registerMQTTListener(callback);
        return;
      } catch (err) {
        tried--;
        this.log.debug('Cannot start MQTT, retrying in 5s.');
        this.log.debug('mqtt err:', err);
        await delayMs(5000);
      }
    }

    this.log.error('Cannot start MQTT!');
  }

  protected async _registerMQTTListener(callback: (data: any) => void) {
    const route = await this.api.getRequest('https://common.lgthinq.com/route').then(data => data.result);

    // key-pair
    const keys = await this.persist.cacheForever('keys', async () => {
      this.log.debug('Generating 2048-bit key-pair...');
      const keys = forge.pki.rsa.generateKeyPair(2048);

      return {
        privateKey: forge.pki.privateKeyToPem(keys.privateKey),
        publicKey: forge.pki.publicKeyToPem(keys.publicKey),
      };
    });

    // CSR
    const csr = await this.persist.cacheForever('csr', async () => {
      this.log.debug('Creating certification request (CSR)...');
      const csr = forge.pki.createCertificationRequest();
      csr.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
      csr.setSubject([
        {
          shortName: 'CN',
          value: 'AWS IoT Certificate',
        },
        {
          shortName: 'O',
          value: 'Amazon',
        },
      ]);
      csr.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());

      return forge.pki.certificationRequestToPem(csr);
    });

    const submitCSR = async () => {
      await this.api.postRequest('service/users/client', {});
      return await this.api.postRequest('service/users/client/certificate', {
        csr: csr.replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '').replace(/(\r\n|\r|\n)/g, ''),
      }).then(data => data.result);
    };

    const urls = new URL(route.mqttServer);
    // get trusted cer root based on hostname
    let rootCAUrl;
    if (urls.hostname.match(/^([^.]+)-ats.iot.([^.]+).amazonaws.com$/g)) {
      // ats endpoint
      rootCAUrl = 'https://www.amazontrust.com/repository/AmazonRootCA1.pem';
    } else if (urls.hostname.match(/^([^.]+).iot.ruic.lgthinq.com$/g)) {
      // LG owned certificate - Comodo CA
      rootCAUrl = 'http://www.tbs-x509.com/Comodo_AAA_Certificate_Services.crt';
    } else {
      // use legacy VeriSign cert for other endpoint
      // eslint-disable-next-line max-len
      rootCAUrl = 'https://www.websecurity.digicert.com/content/dam/websitesecurity/digitalassets/desktop/pdfs/roots/VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem';
    }

    const rootCA = await this.api.getRequest(rootCAUrl);

    const connectToMqtt = async () => {
      // submit csr
      const certificate = await submitCSR();

      const connectData = {
        caCert: Buffer.from(rootCA, 'utf-8'),
        privateKey: Buffer.from(keys.privateKey, 'utf-8'),
        clientCert: Buffer.from(certificate.certificatePem, 'utf-8'),
        clientId: this.api.client_id,
        host: urls.hostname,
      };

      this.log.debug('open mqtt connection to', route.mqttServer);
      const device = awsIotDevice(connectData);

      device.on('error', (err) => {
        this.log.error('mqtt err:', err);
      });
      device.on('connect', () => {
        this.log.info('Successfully connected to the MQTT server.');
        this.log.debug('mqtt connected:', route.mqttServer);
        for (const subscription of certificate.subscriptions) {
          device.subscribe(subscription);
        }
      });
      device.on('message', (topic, payload) => {
        callback(JSON.parse(payload.toString()));
        this.log.debug('mqtt message received:', payload.toString());
      });
      device.on('offline', () => {
        device.end();

        this.log.info('MQTT disconnected, retrying in 60 seconds!');
        setTimeout(async () => {
          await connectToMqtt();
        }, 60000);
      });
    };

    // first call
    await connectToMqtt();
  }

  public async isReady() {
    await this.persist.init();
    await this.api.ready();
  }
}
