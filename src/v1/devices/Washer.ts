import {default as WasherV2} from '../../devices/WasherDryer';
import {LGAcHomebridgePlatform} from '../../platform';
import {CharacteristicValue, Perms, PlatformAccessory} from 'homebridge';
import {Device} from '../../lib/Device';

export default class Washer extends WasherV2 {
  constructor(
    protected readonly platform: LGAcHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Characteristic,
    } = this.platform;

    this.serviceWasherDryer.getCharacteristic(Characteristic.Active).setProps({
      perms: [
        Perms.PAIRED_READ,
        Perms.NOTIFY,
        Perms.PAIRED_WRITE,
      ],
    });
  }

  async setActive(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    await this.platform.ThinQ?.thinq1DeviceControl(device, 'Power', value as boolean ? 'On' : 'Off');
  }
}
