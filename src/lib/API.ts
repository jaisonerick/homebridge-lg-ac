import * as constants from './constants';
import {URL} from 'url';

import {Session} from './Session';
import {Gateway} from './Gateway';

import {requestClient} from './request';
import {Auth} from './Auth';
import {ManualProcessNeeded, NotConnectedError, TokenExpiredError} from '../errors';
import crypto from 'crypto';
import axios from 'axios';

function resolveUrl(from, to) {
  const url = new URL(to, from);
  return url.href;
}

export class API {
  protected _homes;
  protected _gateway: Gateway | undefined;
  protected session: Session = new Session('', '', 0);
  protected auth!: Auth;
  protected userNumber!: string;

  protected username!: string;
  protected password!: string;

  public client_id!: string;

  public httpClient = requestClient;

  public logger;

  constructor(
    protected country: string = 'US',
    protected language: string = 'en-US',
  ) {
    this.logger = console;
  }

  async getRequest(uri, headers?: any) {
    return await this.request('get', uri, headers);
  }

  async postRequest(uri, data, headers?: any) {
    return await this.request('post', uri, data, headers);
  }

  protected async request(method, uri: string, data?: any, headers?: any, retry = false) {
    const requestHeaders = headers || this.defaultHeaders;

    const url = resolveUrl(this._gateway?.thinq2_url, uri);

    return await this.httpClient.request({
      method, url, data,
      headers: requestHeaders,
    }).then(res => res.data).catch(async err => {
      if (err instanceof TokenExpiredError && !retry) {
        return await this.refreshNewToken().then(async () => {
          return await this.request(method, uri, data, headers, true);
        }).catch((err) => {
          this.logger.debug('refresh new token error: ', err);
          return {};
        });
      } else if (err instanceof ManualProcessNeeded) {
        this.logger.warn('Handling new term agreement... If you keep getting this message, ' + err.message);
        await this.auth.handleNewTerm(this.session.accessToken)
          .then(() => {
            this.logger.warn('LG new term agreement is accepted.');
          })
          .catch(err => {
            this.logger.debug(err);
          });

        if (!retry) {
          // retry 1 times
          return await this.request(method, uri, data, headers, true);
        } else {
          return {};
        }
      } else {
        if (axios.isAxiosError(err)) {
          this.logger.debug('request error: ', err.response);
        } else if (!(err instanceof NotConnectedError)) {
          this.logger.debug('request error: ', err);
        }

        return {};
      }
    });
  }

  protected get defaultHeaders() {
    function random_string(length: number) {
      const result: string[] = [];
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for (let i = 0; i < length; i++) {
        result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
      }
      return result.join('');
    }

    const headers = {};
    if (this.session.accessToken) {
      headers['x-emp-token'] = this.session.accessToken;
    }

    if (this.userNumber) {
      headers['x-user-no'] = this.userNumber;
    }

    headers['x-client-id'] = this.client_id || constants.API_CLIENT_ID;

    return {
      'x-api-key': constants.API_KEY,
      'x-thinq-app-ver': '3.6.1200',
      'x-thinq-app-type': 'NUTS',
      'x-thinq-app-level': 'PRD',
      'x-thinq-app-os': 'ANDROID',
      'x-thinq-app-logintype': 'LGE',
      'x-service-code': 'SVC202',
      'x-country-code': this.country,
      'x-language-code': this.language,
      'x-service-phase': 'OP',
      'x-origin': 'app-native',
      'x-model-name': 'samsung/SM-G930L',
      'x-os-version': 'AOS/7.1.2',
      'x-app-version': 'LG ThinQ/3.6.12110',
      'x-message-id': random_string(22),
      'user-agent': 'okhttp/3.14.9',
      ...headers,
    };
  }

  public async getSingleDevice(device_id: string) {
    return await this.getRequest('service/devices/' + device_id).then(data => data.result);
  }

  public async getListDevices() {
    const homes = await this.getListHomes();
    const devices: Record<string, any>[] = [];

    // get all devices in home
    for (let i = 0; i < homes.length; i++) {
      const resp = await this.getRequest('service/homes/' + homes[i].homeId);

      devices.push(...resp.result.devices);
    }

    return devices;
  }

  public async getListHomes() {
    if (!this._homes) {
      this._homes = await this.getRequest('service/homes').then(data => data.result.item);
    }

    return this._homes;
  }

  public async sendCommandToDevice(device_id: string, values: Record<string, any>, command: 'Set' | 'Operation', ctrlKey = 'basicCtrl') {
    return await this.postRequest('service/devices/' + device_id + '/control-sync', {
      ctrlKey,
      'command': command,
      ...values,
    });
  }

  public setRefreshToken(refreshToken) {
    this.session = new Session('', refreshToken, 0);
  }

  public setUsernamePassword(username, password) {
    this.username = username;
    this.password = password;
  }

  public async gateway() {
    if (!this._gateway) {
      const gateway = await requestClient.get(constants.GATEWAY_URL, {headers: this.defaultHeaders}).then(res => res.data.result);
      this._gateway = new Gateway(gateway);
    }

    return this._gateway;
  }

  public async ready() {
    // get gateway first
    const gateway = await this.gateway();

    if (!this.auth) {
      this.auth = new Auth(gateway);
      this.auth.logger = this.logger;
    }

    if (!this.session.hasToken() && this.username && this.password) {
      this.session = await this.auth.login(this.username, this.password);
      await this.refreshNewToken(this.session);
    }

    if (!this.session.hasValidToken() && !!this.session.refreshToken) {
      await this.refreshNewToken(this.session);
    }

    if (!this.userNumber) {
      this.userNumber = await this.auth.getUserNumber(this.session?.accessToken);
    }

    if (!this.client_id) {
      const hash = crypto.createHash('sha256');
      this.client_id = hash.update(this.userNumber + (new Date()).getTime()).digest('hex');
    }
  }

  public async refreshNewToken(session: Session | null = null) {
    session = session || this.session;
    this.session = await this.auth.refreshNewToken(session);
  }
}
