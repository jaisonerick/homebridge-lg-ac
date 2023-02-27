import {LGAcHomebridgePlatform} from '../platform';
import {CharacteristicValue, PlatformAccessory} from 'homebridge';
import {Device} from '../lib/Device';
import {baseDevice} from '../baseDevice';

export enum RotateSpeed {
  LOW = 2,
  MEDIUM = 4,
  HIGH = 6,
  EXTRA = 7,
}

// opMode = 14 => normal mode, can rotate speed
export default class AirPurifier extends baseDevice {
  protected serviceAirPurifier;
  protected serviceAirQuality;
  protected serviceLight;
  protected serviceFilterMaintenance;
  protected serviceAirFastMode;

  constructor(
    protected readonly platform: LGAcHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Service: {
        AirPurifier,
        AirQualitySensor,
        Lightbulb,
        FilterMaintenance,
        Switch,
      },
      Characteristic,
    } = this.platform;

    const device: Device = accessory.context.device;

    // get the service if it exists, otherwise create a new service
    // you can create multiple services for each accessory
    this.serviceAirPurifier = accessory.getService(AirPurifier) || accessory.addService(AirPurifier, 'Air Purifier');

    /**
     * Required Characteristics: Active, CurrentAirPurifierState, TargetAirPurifierState
     */
    this.serviceAirPurifier.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        return this.Status.isPowerOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(this.setActive.bind(this));
    this.serviceAirPurifier.getCharacteristic(Characteristic.TargetAirPurifierState)
      .onSet(this.setTargetAirPurifierState.bind(this));

    /**
     * Optional Characteristics: Name, RotationSpeed, SwingMode
     */
    this.serviceAirPurifier.setCharacteristic(Characteristic.Name, device.name);
    this.serviceAirPurifier.getCharacteristic(Characteristic.SwingMode).onSet(this.setSwingMode.bind(this));
    this.serviceAirPurifier.getCharacteristic(Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .setProps({minValue: 0, maxValue: Object.keys(RotateSpeed).length / 2, minStep: 0.1});

    this.serviceAirQuality = accessory.getService(AirQualitySensor) || accessory.addService(AirQualitySensor);

    this.serviceLight = accessory.getService(Lightbulb) || accessory.addService(Lightbulb, device.name + ' - Light');
    this.serviceLight.getCharacteristic(Characteristic.On).onSet(this.setLight.bind(this));

    if (this.Status.filterMaxTime) {
      this.serviceFilterMaintenance = accessory.getService(FilterMaintenance) || accessory.addService(FilterMaintenance);
      this.serviceFilterMaintenance.updateCharacteristic(Characteristic.Name, 'Filter Maintenance');
      this.serviceAirPurifier.addLinkedService(this.serviceFilterMaintenance);
    }

    this.serviceAirFastMode = accessory.getService('Air Fast');
    if (this.config.air_fast_mode) {
      this.serviceAirFastMode = this.serviceAirFastMode || accessory.addService(Switch, 'Air Fast', 'Air Fast');
      this.serviceAirFastMode.updateCharacteristic(Characteristic.Name, 'Air Fast');
      this.serviceAirFastMode.getCharacteristic(Characteristic.On)
        .onSet(this.setAirFastActive.bind(this));
    } else if (this.serviceAirFastMode) {
      accessory.removeService(this.serviceAirFastMode);
      this.serviceAirFastMode = null;
    }
  }

  public get Status() {
    return new AirPurifierStatus(this.accessory.context.device.snapshot);
  }

  public get config() {
    return Object.assign({}, {
      air_fast_mode: false,
    }, super.config);
  }

  async setAirFastActive(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const device: Device = this.accessory.context.device;
    const isOn = value as boolean ? 1 : 0;
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.miscFuncState.airFast',
      dataValue: isOn as number,
    }).then(() => {
      device.data.snapshot['airState.miscFuncState.airFast'] = isOn as number;
      this.updateAccessoryCharacteristic(device);
    });
  }

  async setActive(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const isOn = value as boolean ? 1 : 0;
    if (this.Status.isPowerOn && isOn) {
      return; // don't send same status
    }

    this.platform.log.debug('Set Active State ->', value);
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.operation',
      dataValue: isOn as number,
    }).then(() => {
      device.data.snapshot['airState.operation'] = isOn as number;
      this.updateAccessoryCharacteristic(device);
    });
  }

  async setTargetAirPurifierState(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    if (!this.Status.isPowerOn || (!!value !== this.Status.isNormalMode)) {
      return; // just skip it
    }

    this.platform.log.debug('Set Target State ->', value);
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.opMode',
      dataValue: value as boolean ? 16 : 14,
    });
  }

  async setRotationSpeed(value: CharacteristicValue) {
    if (!this.Status.isPowerOn || !this.Status.isNormalMode) {
      return;
    }

    this.platform.log.debug('Set Rotation Speed ->', value);
    const device: Device = this.accessory.context.device;
    const values = Object.keys(RotateSpeed);
    const windStrength = parseInt(values[Math.round((value as number)) - 1]) || RotateSpeed.EXTRA;
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.windStrength',
      dataValue: windStrength,
    }).then(() => {
      device.data.snapshot['airState.windStrength'] = windStrength;
      this.updateAccessoryCharacteristic(device);
    });
  }

  async setSwingMode(value: CharacteristicValue) {
    if (!this.Status.isPowerOn || !this.Status.isNormalMode) {
      return;
    }

    const device: Device = this.accessory.context.device;
    const isSwing = value as boolean ? 1 : 0;
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.circulate.rotate',
      dataValue: isSwing,
    }).then(() => {
      device.data.snapshot['airState.circulate.rotate'] = isSwing;
      this.updateAccessoryCharacteristic(device);
    });
  }

  async setLight(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const device: Device = this.accessory.context.device;
    const isLightOn = value as boolean ? 1 : 0;
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: 'airState.lightingState.signal',
      dataValue: isLightOn,
    }).then(() => {
      device.data.snapshot['airState.lightingState.signal'] = isLightOn;
      this.updateAccessoryCharacteristic(device);
    });
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);
    const {
      Characteristic,
      Characteristic: {
        TargetAirPurifierState,
        FilterChangeIndication,
      },
    } = this.platform;

    this.serviceAirPurifier.updateCharacteristic(Characteristic.Active, this.Status.isPowerOn ? 1 : 0);
    this.serviceAirPurifier.updateCharacteristic(Characteristic.CurrentAirPurifierState, this.Status.isPowerOn ? 2 : 0);
    this.serviceAirPurifier.updateCharacteristic(TargetAirPurifierState,
      this.Status.isNormalMode ? TargetAirPurifierState.MANUAL : TargetAirPurifierState.AUTO);
    this.serviceAirPurifier.updateCharacteristic(Characteristic.SwingMode, this.Status.isSwing ? 1 : 0);
    this.serviceAirPurifier.updateCharacteristic(Characteristic.RotationSpeed, this.Status.rotationSpeed);

    if (this.Status.filterMaxTime && this.serviceFilterMaintenance) {
      this.serviceFilterMaintenance.updateCharacteristic(Characteristic.FilterLifeLevel, this.Status.filterUsedTimePercent);
      this.serviceFilterMaintenance.updateCharacteristic(FilterChangeIndication,
        this.Status.filterUsedTimePercent > 95 ? FilterChangeIndication.CHANGE_FILTER : FilterChangeIndication.FILTER_OK);
    }

    // airState.quality.sensorMon = 1 mean sensor always running even device not running
    this.serviceAirQuality.updateCharacteristic(Characteristic.AirQuality, this.Status.airQuality.overall);
    this.serviceAirQuality.updateCharacteristic(Characteristic.PM2_5Density, this.Status.airQuality.PM2);
    this.serviceAirQuality.updateCharacteristic(Characteristic.PM10Density, this.Status.airQuality.PM10);
    this.serviceAirQuality.updateCharacteristic(Characteristic.StatusActive, this.Status.airQuality.isOn);

    this.serviceLight.updateCharacteristic(Characteristic.On, this.Status.isLightOn);

    if (this.config.air_fast_mode && this.serviceAirFastMode) {
      this.serviceAirFastMode.updateCharacteristic(Characteristic.On, this.Status.isAirFastEnable);
    }
  }
}

export class AirPurifierStatus {
  constructor(protected data) {
  }

  public get isPowerOn() {
    return this.data['airState.operation'] as boolean;
  }

  public get isLightOn() {
    return this.isPowerOn && this.data['airState.lightingState.signal'] as boolean;
  }

  public get isSwing() {
    return (this.data['airState.circulate.rotate'] || 0) as boolean;
  }

  public get airQuality() {
    return {
      isOn: this.isPowerOn || !!this.data['airState.quality.sensorMon'],
      overall: parseInt(this.data['airState.quality.overall']),
      PM2: parseInt(this.data['airState.quality.PM2'] || '0'),
      PM10: parseInt(this.data['airState.quality.PM10'] || '0'),
    };
  }

  public get rotationSpeed() {
    const index = Object.keys(RotateSpeed).indexOf(parseInt(this.data['airState.windStrength']).toString());
    return index !== -1 ? index + 1 : Object.keys(RotateSpeed).length / 2;
  }

  public get isNormalMode() {
    return this.data['airState.opMode'] === 14;
  }

  public get filterUsedTimePercent() {
    if (!this.filterMaxTime) {
      return 0;
    }

    return Math.round((1 - (this.filterUseTime / this.filterMaxTime)) * 100);
  }

  public get filterMaxTime() {
    return this.data['airState.filterMngStates.maxTime'] || 0;
  }

  public get filterUseTime() {
    return this.data['airState.filterMngStates.useTime'] || 0;
  }

  public get isAirFastEnable() {
    return this.data['airState.miscFuncState.airFast'] || 0;
  }
}
