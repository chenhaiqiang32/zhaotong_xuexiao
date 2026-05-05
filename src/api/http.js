import axios from "axios";

export const http = axios.create({
  baseURL: (window?.configs?.smartLockApiBase || "/api/smart-lock").trim(),
  timeout: 15000,
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    // 统一返回原始错误，调用方可切 mock
    return Promise.reject(err);
  }
);

