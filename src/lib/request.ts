import axios, {AxiosInstance} from 'axios';
import {
  ManualProcessNeeded,
  ManualProcessNeededErrorCode,
  NotConnectedError,
  TokenExpiredErrorCode,
  TokenExpiredError,
} from '../errors';
import axiosRetry from 'axios-retry';

const client = axios.create();
client.defaults.timeout = 60000; // 60s timeout
axiosRetry(client, {
  retries: 2, // try 3 times
  retryDelay: (retryCount) => {
    return retryCount * 2000;
  },
  retryCondition: (err) => {
    if (err.code?.indexOf('ECONN') === 0) {
      return true;
    }

    return err.response !== undefined && [500, 501, 502, 503, 504].includes(err.response.status);
  },
  shouldResetTimeout: true, // reset timeout each retries
});
client.interceptors.response.use(undefined, (err) => {
  if (!err.response || err.response.data?.resultCode === '9999') {
    throw new NotConnectedError();
  } else if (err.response.data?.resultCode === TokenExpiredErrorCode) {
    throw new TokenExpiredError();
  } else if (err.response.data?.resultCode === ManualProcessNeededErrorCode) {
    throw new ManualProcessNeeded('Please open the native LG App and sign in to your account to see what happened, ' +
      'maybe new agreement need your accept. Then try restarting Homebridge.');
  }

  return Promise.reject(err);
});

export const requestClient = client as AxiosInstance;
