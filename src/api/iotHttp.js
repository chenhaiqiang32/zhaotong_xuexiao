import axios from "axios";

/**
 * IoT 设备接口（iot.niat.edu.cn）
 * 开发环境：window.configs.iotApiBase = "/api/iot"，由 vite 代理到 https://iot.niat.edu.cn/api
 */
export const iotHttp = axios.create({
  baseURL: (window?.configs?.iotApiBase || "/api").trim(),
  timeout: 15000,
});

/**
 * 旧门锁 JetLinks 接口
 * 开发环境：window.configs.smartLockApiBase = "/api/smart-lock"
 */
export const smartLockHttp = axios.create({
  baseURL: (window?.configs?.smartLockApiBase || "/api").trim(),
  timeout: 15000,
});

iotHttp.interceptors.response.use(
  (res) => res,
  (err) => Promise.reject(err)
);

smartLockHttp.interceptors.response.use(
  (res) => res,
  (err) => Promise.reject(err)
);
