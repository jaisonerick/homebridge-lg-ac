import EventEmitter from 'events';
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {ACController} from '../../lib/controllers/ACController';
import {Device} from '../../lib/Device';
import {ThinQ} from '../../lib/ThinQ';
import {LGAcHomebridgePlatform} from '../../platform';

export class LightUnit extends EventEmitter {
  readonly device: Device;
  readonly service: Service;
  readonly ThinQ: ThinQ;

  constructor(
    public readonly controller: ACController,
    public readonly platform: LGAcHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    super();
    const {
      Service: {Switch},
      Characteristic,
    } = this.platform;


    this.ThinQ = this.platform.ThinQ;
    this.device = this.accessory.context.device;

    this.service = this.accessory.getService(Switch) ||
      this.accessory.addService(Switch, 'LED', 'LED');

    this.service.updateCharacteristic(Characteristic.ConfiguredName, 'LED');

    this.service
      .getCharacteristic(Characteristic.On)
      .onSet((value: CharacteristicValue) => {
        this.controller.setLight(value as boolean);
      });
  }

  update(device: Device) {
    const { Characteristic } = this.platform;
    this.service.updateCharacteristic(Characteristic.On, this.controller.isLightOn);
  }

  remove() {
    this.accessory.removeService(this.service);
  }
}
