import {baseDevice} from '../baseDevice';
import {LGAcHomebridgePlatform} from '../platform';
import {PlatformAccessory, Service} from 'homebridge';
import {Device} from '../lib/Device';
import {MainUnit} from './AirConditioner/MainUnit';
import {FanUnit} from './AirConditioner/FanUnit';
import {ACController} from '../lib/controllers/ACController';
import {ButtonType, ButtonUnit} from './AirConditioner/ButtonUnit';

interface Unit {
  update: (device: Device) => void;
}

export default class AirConditioner extends baseDevice {
  protected serviceLabelButtons;

  protected serviceLabel;

  protected controller: ACController;
  protected units: Unit[] = [];

  constructor(
    protected readonly platform: LGAcHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const device: Device = this.accessory.context.device;
    this.controller = new ACController(this.platform.ThinQ, device);
    this.controller.on('UPDATE', (device: Device) => this.updateAccessoryCharacteristic(device));

    const mainService = new MainUnit(this.controller, platform, accessory, this.config);
    this.units.push(mainService);

    const fanService = new FanUnit(this.controller, platform, accessory);
    if (this.config['ac_fan_control']) {
      mainService.link(fanService.service);
      this.units.push(fanService);
    } else {
      fanService.remove();
    }

    const buttonSet: [string, ButtonType][] = [
      ['ac_led_control', ButtonType.LED],
      ['ac_jetmode_control', ButtonType.JET_MODE],
      ['ac_comfort_sleep_control', ButtonType.COMFORT_SLEEP],
    ];

    buttonSet.forEach(([config, id]) => {
      const button = new ButtonUnit(this.controller, platform, accessory, id);

      if (this.config[config]) {
        mainService.link(button.service);
        this.units.push(button);
      } else {
        button.remove();
      }
    });
  }

  public get config() {
    return Object.assign({}, {
      ac_led_control: false,
      ac_fan_control: false,
      ac_comfort_sleep_control: false,
      ac_jetmode_control: false,
    }, super.config);
  }


  public updateAccessoryCharacteristic(device: Device) {
    this.accessory.context.device = device;

    this.units.forEach((unit) => unit.update(device));
  }
}
