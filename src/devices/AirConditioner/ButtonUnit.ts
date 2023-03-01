import EventEmitter from 'events';
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {ACController, FanSpeed} from '../../lib/controllers/ACController';
import {Device} from '../../lib/Device';
import {ThinQ} from '../../lib/ThinQ';
import {LGAcHomebridgePlatform} from '../../platform';

export const enum ButtonType {
  JET_MODE,
  COMFORT_SLEEP,
  LED
}

export class ButtonUnit extends EventEmitter {
  readonly device: Device;
  readonly service: Service;
  readonly ThinQ: ThinQ;

  constructor(
    public readonly controller: ACController,
    public readonly platform: LGAcHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
    public readonly buttonType: ButtonType,
  ) {
    super();
    const {
      Service: {Switch},
      Characteristic,
    } = this.platform;


    this.ThinQ = this.platform.ThinQ;
    this.device = this.accessory.context.device;

    this.service = this.accessory.getService(this.buttonName) ||
      this.accessory.addService(Switch, this.buttonName, this.buttonName);

    this.service.updateCharacteristic(Characteristic.ConfiguredName, this.buttonName);

    this.service
      .getCharacteristic(Characteristic.On)
      .onSet((value: CharacteristicValue) => {
        this.toggle(value as boolean);
      });
  }

  public get buttonName() {
    switch (this.buttonType) {
      case ButtonType.COMFORT_SLEEP: return 'Comfort Sleep';
      case ButtonType.JET_MODE: return 'Jet Mode';
      case ButtonType.LED: return 'LED';
    }
  }

  public get currentState() {
    switch (this.buttonType) {
      case ButtonType.COMFORT_SLEEP: return this.controller.comfortMode;
      case ButtonType.JET_MODE: return this.controller.jetMode;
      case ButtonType.LED: return this.controller.isLightOn;
    }
  }

  toggle(isOn: boolean) {
    switch (this.buttonType) {
      case ButtonType.COMFORT_SLEEP:
        return this.controller.setComfortSleep(isOn);
      case ButtonType.JET_MODE:
        return this.controller.setJetMode(isOn);
      case ButtonType.LED:
        return this.controller.setLight(isOn);
    }
  }

  update(device: Device) {
    const { Characteristic } = this.platform;

    this.service.updateCharacteristic(Characteristic.On, this.currentState);
  }

  remove() {
    this.accessory.removeService(this.service);
  }
}
