import EventEmitter from 'events';
import { Device } from '../Device';
import {EnumValue, RangeValue} from '../DeviceModel';
import { ThinQ } from '../ThinQ';

export const enum CurrentMode {
  COOL,
  HEAT,
  OFF
}

export const enum WindMode {
  NONE = 0,
  VERTICAL = 1,
  HORIZONTAL = 2,
  BOTH = 3,
}

const enum OpMode {
  AUTO = 6,
  COOL = 0,
  HEAT = 4,
  FAN = 2,
  DRY = 1,
  AIR_CLEAN = 5,
}

export const enum FanSpeed {
  LOW = 2,
  LOW_MEDIUM = 3,
  MEDIUM = 4,
  MEDIUM_HIGH = 5,
  HIGH = 6,
  AUTO = 8,
}

export class ACController extends EventEmitter {
  constructor(
    public readonly ThinQ: ThinQ,
    public readonly device: Device,
  ) {
    super();
  }

  public get isPowerOn() {
    return !!this.data['airState.operation'] as boolean;
  }

  public get isLightOn() {
    return !!this.data['airState.lightingState.displayControl'];
  }

  // fan service
  public get windStrength() {
    return this.data['airState.windStrength'] as FanSpeed;
  }

  public get isSwingOn() {
    const vStep = Math.floor((this.data['airState.wDir.vStep'] || 0) / 100),
      hStep = Math.floor((this.data['airState.wDir.hStep'] || 0) / 100);
    return !!(vStep + hStep);
  }

  public get currentTemperature() {
    return this.data['airState.tempState.current'] as number;
  }

  public get targetTemperature() {
    return this.data['airState.tempState.target'] as number;
  }

  public get comfortMode() {
    return this.data['airState.reservation.sleepTime'] > 0;
  }

  public get jetMode() {
    return !!this.data['airState.wMode.jet'];
  }

  private get opMode() {
    return this.data['airState.opMode'] as OpMode;
  }

  get currentMode() {
    if (!this.isPowerOn) {
      return CurrentMode.OFF;
    }

    let opMode = this.opMode;
    if (![OpMode.HEAT, OpMode.COOL].includes(opMode)) {
      opMode = this.currentTemperature <= this.targetTemperature ? OpMode.COOL : OpMode.HEAT;
    }

    switch (opMode) {
      case OpMode.HEAT:
        return CurrentMode.HEAT;
      case OpMode.COOL:
        return CurrentMode.COOL;
    }

    throw new Error('Unreachable');
  }

  public get targetTemperatureRange() {
    let targetTemperatureValue = this.device.deviceModel.value('airState.tempState.limitMin') as RangeValue;
    if (!targetTemperatureValue) {
      targetTemperatureValue = this.device.deviceModel.value('airState.tempState.target') as RangeValue;
    }
    return targetTemperatureValue;
  }

  public get windDirectionAllowed(): WindMode {
    let allowedDirections = WindMode.NONE;

    const racSubMode = (this.device.deviceModel.value('support.racSubMode') as EnumValue).options as Record<string, string>;
    for (const value of Object.values(racSubMode)) {
      if (value.match(/WIND_DIRECTION_STEP_LEFT_RIGHT/)) {
        allowedDirections |= WindMode.HORIZONTAL;
      }
      if (value.match(/WIND_DIRECTION_STEP_UP_DOWN/)) {
        allowedDirections |= WindMode.VERTICAL;
      }
    }
    return allowedDirections;
  }

  async setActive(isOn: number) {
    if (this.isPowerOn && isOn) {
      return; // don't send same status
    }

    await this.ThinQ.deviceControl(this.device.id, {
      dataKey: 'airState.operation',
      dataValue: isOn,
    }, 'Operation').then(() => {
      this.device.snapshot['airState.operation'] = isOn;
      this.emit('UPDATE', this.device);
    });

    if (isOn) {
      await this.setOpMode(OpMode.AUTO);
    }
  }

  async setTargetTemperature(temperature: number) {
    if (!this.isPowerOn) {
      return;
    }

    if (temperature === this.targetTemperature) {
      return;
    }

    await this.ensureAutoMode();

    return this.ThinQ.deviceControl(this.device.id, {
      dataKey: 'airState.tempState.target',
      dataValue: temperature,
    }).then(() => {
      this.device.snapshot['airState.tempState.target'] = temperature;
      this.emit('UPDATE', this.device);
    });
  }

  async setFanSpeed(level: FanSpeed) {
    if (!this.isPowerOn) {
      return;
    }

    if (this.windStrength === level) {
      return;
    }

    return this.ThinQ?.deviceControl(this.device.id, {
      dataKey: 'airState.windStrength',
      dataValue: level,
    }).then(() => {
      this.device.snapshot['airState.windStrength'] = level;
      this.emit('UPDATE', this.device);
    });
  }

  async setLight(isOn: boolean) {
    if (!this.isPowerOn) {
      return;
    }

    if (isOn === this.isLightOn) {
      return;
    }

    this.ThinQ?.deviceControl(this.device.id, {
      dataKey: 'airState.lightingState.displayControl',
      dataValue: isOn ? 1 : 0,
    }).then(() => {
      this.device.snapshot['airState.lightingState.displayControl'] = isOn ? 1 : 0;
      this.emit('UPDATE', this.device);
    });
  }

  async setSwingMode(isOn: boolean) {
    if (!this.isPowerOn) {
      return;
    }

    const swingValue = isOn ? 100 : 0;
    switch (this.windDirectionAllowed) {
      case WindMode.BOTH:
        return this.ThinQ.deviceControl(this.device.id, {
          dataKey: null,
          dataValue: null,
          dataSetList: {
            'airState.wDir.vStep': swingValue,
            'airState.wDir.hStep': swingValue,
          },
          dataGetList: null,
        }, 'Set', 'favoriteCtrl').then(() => {
          this.device.snapshot['airState.wDir.vStep'] = swingValue;
          this.device.snapshot['airState.wDir.hStep'] = swingValue;
          this.emit('UPDATE', this.device);
        });
      case WindMode.VERTICAL:
        return this.ThinQ.deviceControl(this.device.id, {
          dataKey: 'airState.wDir.vStep',
          dataValue: swingValue,
        }).then(() => {
          this.device.snapshot['airState.wDir.vStep'] = swingValue;
          this.emit('UPDATE', this.device);
        });
      case WindMode.HORIZONTAL:
        return this.ThinQ.deviceControl(this.device.id, {
          dataKey: 'airState.wDir.hStep',
          dataValue: swingValue,
        }).then(() => {
          this.device.snapshot['airState.wDir.hStep'] = swingValue;
          this.emit('UPDATE', this.device);
        });
    }
  }

  async setComfortSleep(isOn: boolean) {
    const sleepTime = isOn ? 420 : 0;
    const vStep = isOn ? 1 : 0;

    return this.ThinQ?.deviceControl(this.device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList: {
        'airState.reservation.sleepTime': sleepTime,
        'airState.wDir.vStep': vStep,
      },
      dataGetList: null,
    }, 'Set', 'favoriteCtrl').then(() => {
      this.device.snapshot['airState.reservation.sleepTime'] = sleepTime;
      this.device.snapshot['airState.wDir.vStep'] = vStep;
      this.emit('UPDATE', this.device);
    });
  }

  async setJetMode(isOn: boolean) {
    return this.ThinQ?.deviceControl(this.device.id, {
      dataKey: 'airState.wMode.jet',
      dataValue: isOn ? 1 : 0,
    }).then(() => {
      this.device.snapshot['airState.wMode.jet'] = isOn ? 1 : 0;
      this.emit('UPDATE', this.device);
    });
  }

  private async setOpMode(opMode: OpMode) {
    if (this.opMode === opMode) {
      return;
    }

    await this.ThinQ?.deviceControl(this.device.id, {
      dataKey: 'airState.opMode',
      dataValue: opMode,
    }).then(() => {
      this.device.snapshot['airState.opMode'] = opMode;
      this.emit('UPDATE', this.device);
    });

    await this.setLight(false);
  }

  private async ensureAutoMode() {
    if (this.opMode !== OpMode.AUTO) {
      await this.setOpMode(OpMode.AUTO);
    }
  }

  private get data() {
    return this.device.snapshot;
  }
}
