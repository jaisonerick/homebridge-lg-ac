import { Categories } from 'homebridge';
import {Device} from './lib/Device';
import AirConditioner from './devices/AirConditioner';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Helper {
  public static make(device: Device) {
    // thinq2
    switch (device.type) {
      case 'AC': return AirConditioner;
    }

    return null;
  }

  public static category(device: Device) {
    switch (device.type) {
      case 'AC': return Categories.AIR_CONDITIONER;
    }
    return Categories.OTHER;
  }
}

export function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

export function mergeDeep(target, ...sources) {
  if (!sources.length) {
    return target;
  }
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return mergeDeep(target, ...sources);
}

export function fToC(fahrenheit) {
  return parseFloat(((fahrenheit - 32) * 5 / 9).toFixed(1));
}

export function cToF(celsius) {
  return Math.round(celsius * 9 / 5 + 32);
}
