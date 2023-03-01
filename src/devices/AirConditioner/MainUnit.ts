import EventEmitter from 'events';
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {ACController, CurrentMode} from '../../lib/controllers/ACController';
import {Device} from '../../lib/Device';
import {ThinQ} from '../../lib/ThinQ';
import {LGAcHomebridgePlatform} from '../../platform';

interface AcConfig {
  ac_mode: 'AUTO' | 'COOL' | 'HEAT' | 'BOTH';
}

export class MainUnit extends EventEmitter {
  readonly device: Device;
  readonly service: Service;
  readonly ThinQ: ThinQ;

  constructor(
    public readonly controller: ACController,
    public readonly platform: LGAcHomebridgePlatform,
    public readonly accessory: PlatformAccessory,
    public readonly config: AcConfig,
  ) {
    super();
    const {
      Service: {Thermostat},
      Characteristic,
    } = this.platform;

    this.ThinQ = this.platform.ThinQ;
    this.device = this.accessory.context.device;

    this.service = this.accessory.getService(Thermostat) ||
      this.accessory.addService(Thermostat, this.device.name);
    this.service.setPrimaryService();

    this.service
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [Characteristic.TargetHeatingCoolingState.AUTO, Characteristic.TargetHeatingCoolingState.OFF],
      })
      .onSet((value: CharacteristicValue) => {
        this.controller.setActive(value === Characteristic.TargetHeatingCoolingState.AUTO ? 1 : 0);
      });

    this.service
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .updateValue(this.currentHeatingCoolingState);

    this.service.updateCharacteristic(Characteristic.CurrentTemperature, this.controller.currentTemperature);
    this.service.updateCharacteristic(
      Characteristic.TemperatureDisplayUnits, Characteristic.TemperatureDisplayUnits.CELSIUS);

    const targetTemperatureCharacteristic = this.service.getCharacteristic(Characteristic.TargetTemperature);
    if(this.controller.targetTemperatureRange) {
      targetTemperatureCharacteristic.setProps({
        minValue: this.controller.targetTemperatureRange.min,
        maxValue: this.controller.targetTemperatureRange.max,
        minStep: 0.01,
      });
    }
    targetTemperatureCharacteristic.onSet((value: CharacteristicValue) => {
      this.controller.setTargetTemperature(value as number);
    });
  }

  update(device: Device) {
    const {
      Characteristic,
      Characteristic: {
        TargetHeatingCoolingState,
      },
    } = this.platform;

    this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState,
      this.controller.isPowerOn ? TargetHeatingCoolingState.AUTO : TargetHeatingCoolingState.OFF);

    this.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.currentHeatingCoolingState);

    if (this.controller.currentTemperature) {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, this.controller.currentTemperature);
    }

    if (this.controller.targetTemperature) {
      this.service.updateCharacteristic(Characteristic.TargetTemperature, this.controller.targetTemperature);
    }
  }

  public get currentHeatingCoolingState() {
    switch (this.controller.currentMode) {
      case CurrentMode.OFF:
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      case CurrentMode.COOL:
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      case CurrentMode.HEAT:
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }
  }

  link(service: Service) {
    this.service.addLinkedService(service);
  }

  remove() {
    this.accessory.removeService(this.service);
  }
}
