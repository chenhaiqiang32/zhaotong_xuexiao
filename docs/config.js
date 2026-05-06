/** Global Configs */
window.configs = {
  /** 门锁接口（开发环境由 vite 代理到 jetlinks，见 vite.config.js） */
  smartLockApiBase: "/api/smart-lock",
  websocket: "ws://172.23.57.52:9999/gis/gis/websocket/client", //人员定位数据websocket地址
  floorToName: {
    "1楼_室内": {
      "4c": "中心数据机房",
    },
    "2楼_室内": {
      "2-1c": "无线发射机房",
      "1-1c": "UPS机房",
    },
    柴油发电机房_室内: {
      "1c": "柴油发电机房",
    },
  },
};
window.floorToName = {
  aF01: {
    path: "inDoor/A001B001",
    floor: "F01",
  },
  aF02: {
    path: "inDoor/A001B001",
    floor: "F02",
  },
  aF03: {
    path: "inDoor/A001B001",
    floor: "F03",
  },
  bF01: {
    path: "inDoor/A001B002",
    floor: "F01",
  },
};
