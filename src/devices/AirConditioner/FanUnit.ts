import EventEmitter from 'events';
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {ACController, FanSpeed, WindMode} from '../../lib/controllers/ACController';
import {Device} from '../../lib/Device';
import {ThinQ} from '../../lib/ThinQ';
import {LGAcHomebridgePlatform} from '../../platform';

export class FanUnit extends EventEmitter {
  readonly device: Device;
  readonly service: Service;
  readonly ThinQ: ThinQ;

  private fanSpeedTimeout?: NodeJS.Timeout;
  private fanSpeeds = [FanSpeed.LOW, FanSpeed.LOW_MEDIUM, FanSpeed.MEDIUM, FanSpeed.MEDIUM_HIGH, FanSpeed.HIGH];

  private lastSpeed?: FanSpeed;

  constructor(
    public readonly controller: ACController,
    public readonly platform: LGAcHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super();
    const {
      Service: {Fanv2},
      Characteristic,
    } = this.platform;


    this.ThinQ = this.platform.ThinQ;
    this.device = this.accessory.context.device;

    this.service = this.accessory.getService(Fanv2) ||
      this.accessory.addService(Fanv2, this.device.name);

    this.service.updateCharacteristic(Characteristic.Name, 'Fan');

    this.lastSpeed = this.controller.windStrength !== FanSpeed.AUTO ? this.controller.windStrength : undefined;
    this.service.updateCharacteristic(
      Characteristic.CurrentFanState,
      this.controller.isPowerOn ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.INACTIVE,
    );

    this.service.getCharacteristic(Characteristic.TargetFanState)
      .onSet((value: CharacteristicValue) => {
        switch (value) {
          case Characteristic.TargetFanState.AUTO:
            this.controller.setFanSpeed(FanSpeed.AUTO);
            break;
          case Characteristic.TargetFanState.MANUAL:
            this.controller.setFanSpeed(this.lastSpeed ?? FanSpeed.MEDIUM);
            break;
        }
      });

    this.service.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: this.fanSpeeds.length - 1,
        minStep: 1,
      })
      .onSet((value: CharacteristicValue) => {
        this.throttle(() => {
          this.controller.setFanSpeed(this.fanSpeeds[value as number]);
        });
      });

    this.service.getCharacteristic(Characteristic.SwingMode)
      .onSet((value: CharacteristicValue) => {
        this.controller.setSwingMode(!!value as boolean);
      });
  }

  private throttle(callback: () => void, waitingTime = 1_000) {
    if (this.fanSpeedTimeout) {
      clearTimeout(this.fanSpeedTimeout);
      this.fanSpeedTimeout = undefined;
    }

    this.fanSpeedTimeout = setTimeout(() => {
      callback();
    }, waitingTime);
  }

  update(device: Device) {
    const {
      Characteristic,
      Characteristic: {
        TargetFanState,
      },
    } = this.platform;

    this.service.updateCharacteristic(
      Characteristic.CurrentFanState,
      this.controller.isPowerOn ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.INACTIVE,
    );

    if (this.controller.windStrength === FanSpeed.AUTO) {
      this.service.updateCharacteristic(Characteristic.TargetFanState, TargetFanState.AUTO);
    } else {
      this.lastSpeed = this.controller.windStrength;

      this.service.updateCharacteristic(Characteristic.TargetFanState, TargetFanState.MANUAL);
      this.service.updateCharacteristic(
        Characteristic.RotationSpeed, this.fanSpeeds.indexOf(this.controller.windStrength));
    }

    this.service.updateCharacteristic(Characteristic.SwingMode, this.controller.isSwingOn
      ? Characteristic.SwingMode.SWING_ENABLED
      : Characteristic.SwingMode.SWING_DISABLED);
  }

  remove() {
    this.accessory.removeService(this.service);
  }
}
