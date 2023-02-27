import {baseDevice} from '../baseDevice';
import {LGAcHomebridgePlatform} from '../platform';
import {CharacteristicValue, Perms, PlatformAccessory} from 'homebridge';
import {Device} from '../lib/Device';
import {PlatformType} from '../lib/constants';
import {DeviceModel} from '../lib/DeviceModel';

export const NOT_RUNNING_STATUS = ['COOLDOWN', 'POWEROFF', 'POWERFAIL', 'INITIAL', 'PAUSE', 'AUDIBLE_DIAGNOSIS', 'FIRMWARE',
  'COURSE_DOWNLOAD', 'ERROR', 'END'];

export default class WasherDryer extends baseDevice {
  public isRunning = false;
  protected serviceWasherDryer;
  protected serviceEventFinished;
  protected serviceDoorLock;
  protected serviceTubCleanMaintenance;

  constructor(
    protected readonly platform: LGAcHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Service: {
        OccupancySensor,
        LockMechanism,
        Valve,
        StatelessProgrammableSwitch,
      },
      Characteristic,
      Characteristic: {
        LockCurrentState,
      },
    } = this.platform;

    const device: Device = accessory.context.device;

    this.serviceWasherDryer = accessory.getService(Valve) || accessory.addService(Valve, device.name);
    this.serviceWasherDryer.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .setProps({
        perms: [
          Perms.PAIRED_READ,
          Perms.NOTIFY,
        ],
      })
      .updateValue(Characteristic.Active.INACTIVE);
    this.serviceWasherDryer.setCharacteristic(Characteristic.Name, device.name);
    this.serviceWasherDryer.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    this.serviceWasherDryer.setCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    this.serviceWasherDryer.getCharacteristic(Characteristic.RemainingDuration).setProps({
      maxValue: 86400, // 1 day
    });

    // only thinq2 support door lock status
    this.serviceDoorLock = accessory.getService(LockMechanism);
    if (this.config.washer_door_lock && device.platform === PlatformType.ThinQ2 && 'doorLock' in device.snapshot?.washerDryer) {
      this.serviceDoorLock = this.serviceDoorLock || accessory.addService(LockMechanism, device.name + ' - Door');
      this.serviceDoorLock.getCharacteristic(Characteristic.LockCurrentState)
        .onSet(this.setActive.bind(this))
        .setProps({
          minValue: 0,
          maxValue: 3,
          validValues: [LockCurrentState.UNSECURED, LockCurrentState.SECURED],
        })
        .updateValue(LockCurrentState.UNSECURED);
      this.serviceDoorLock.getCharacteristic(Characteristic.LockTargetState)
        .onSet(this.setActive.bind(this))
        .updateValue(Characteristic.LockTargetState.UNSECURED);
    } else if (this.serviceDoorLock) {
      accessory.removeService(this.serviceDoorLock);
    }

    this.serviceEventFinished = accessory.getService(OccupancySensor);
    if (this.config.washer_trigger as boolean) {
      this.serviceEventFinished = this.serviceEventFinished || accessory.addService(OccupancySensor, device.name + ' - Program Finished');
      // eslint-disable-next-line max-len
      this.serviceEventFinished.updateCharacteristic(Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (this.serviceEventFinished) {
      accessory.removeService(this.serviceEventFinished);
    }

    // tub clean coach
    this.serviceTubCleanMaintenance = accessory.getService('Tub Clean Coach')
      || accessory.addService(StatelessProgrammableSwitch, 'Tub Clean Coach', 'Tub Clean Coach');
    this.serviceTubCleanMaintenance.updateCharacteristic(Characteristic.Name, 'Tub Clean Coach');
    this.serviceTubCleanMaintenance.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .setProps({
        validValues: [0], // single press
      });
    this.serviceWasherDryer.addLinkedService(this.serviceTubCleanMaintenance);
  }

  public get Status() {
    return new WasherDryerStatus(this.accessory.context.device.snapshot?.washerDryer, this.accessory.context.device.deviceModel);
  }

  public get config() {
    return Object.assign({}, {
      washer_trigger: false,
      washer_door_lock: false,
    }, super.config);
  }

  async setActive(value: CharacteristicValue) {
    if (!this.Status.isRemoteStartEnable) {
      return;
    }

    return;
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {
      Characteristic,
    } = this.platform;
    this.serviceWasherDryer.updateCharacteristic(Characteristic.Active, this.Status.isPowerOn ? 1 : 0);
    this.serviceWasherDryer.updateCharacteristic(Characteristic.InUse, this.Status.isRunning ? 1 : 0);
    const prevRemainDuration = this.serviceWasherDryer.getCharacteristic(Characteristic.RemainingDuration).value;
    if (this.Status.remainDuration !== prevRemainDuration) {
      this.serviceWasherDryer.updateCharacteristic(Characteristic.RemainingDuration, this.Status.remainDuration);
    }

    this.serviceWasherDryer.updateCharacteristic(Characteristic.StatusFault,
      this.Status.isError ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT);

    if (this.config.washer_door_lock && this.serviceDoorLock) {
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockCurrentState,
        this.Status.isDoorLocked ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED);
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockTargetState, this.Status.isDoorLocked ? 1 : 0);
    }
  }

  public update(snapshot) {
    super.update(snapshot);

    const washerDryer = snapshot.washerDryer;
    if (!washerDryer) {
      return;
    }

    const {
      Characteristic: {
        OccupancyDetected,
        ProgrammableSwitchEvent,
      },
    } = this.platform;

    // when washer state is changed
    if (this.config.washer_trigger as boolean && this.serviceEventFinished
      && ('preState' in washerDryer || 'processState' in washerDryer) && 'state' in washerDryer) {

      // detect if washer program in done
      if ((['END', 'COOLDOWN'].includes(washerDryer.state)
          && !NOT_RUNNING_STATUS.includes(washerDryer.preState || washerDryer.processState))
          || (this.isRunning && !this.Status.isRunning)) {
        this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
        this.isRunning = false; // marked device as not running

        // turn it off after 10 minute
        setTimeout(() => {
          this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }, 10000 * 60);
      }

      // detect if washer program is start
      if (this.Status.isRunning && !this.isRunning) {
        this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        this.isRunning = true;
      }
    }

    if ('TCLCount' in washerDryer && this.Status.TCLCount >= 30) {
      this.serviceTubCleanMaintenance.updateCharacteristic(ProgrammableSwitchEvent, ProgrammableSwitchEvent.SINGLE_PRESS);
    }
  }
}

export class WasherDryerStatus {
  constructor(protected data, protected deviceModel: DeviceModel) {
  }

  public get isPowerOn() {
    return !['POWEROFF', 'POWERFAIL'].includes(this.data?.state);
  }

  public get isRunning() {
    return this.isPowerOn && !NOT_RUNNING_STATUS.includes(this.data?.state);
  }

  public get isError() {
    return this.data?.state === 'ERROR';
  }

  public get isRemoteStartEnable() {
    return this.data.remoteStart === this.deviceModel.lookupMonitorName('remoteStart', '@CP_ON_EN_W');
  }

  public get isDoorLocked() {
    return this.data.doorLock === this.deviceModel.lookupMonitorName('doorLock', '@CP_ON_EN_W');
  }

  public get remainDuration() {
    const remainTimeHour = this.data?.remainTimeHour || 0,
      remainTimeMinute = this.data?.remainTimeMinute || 0;

    let remainingDuration = 0;
    if (this.isRunning) {
      remainingDuration = remainTimeHour * 3600 + remainTimeMinute * 60;
    }

    return remainingDuration;
  }

  public get TCLCount() {
    return Math.min(parseInt(this.data?.TCLCount || 0), 30);
  }
}
