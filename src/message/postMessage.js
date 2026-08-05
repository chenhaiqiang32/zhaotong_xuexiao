export const postOnLoading = () => {
  window.parent.postMessage(
    {
      // 三维开始加载模型
      cmd: "onLoading",
    },
    "*"
  );
};
export const postOnLoaded = () => {
  window.parent.postMessage(
    {
      // 三维结束模型加载
      cmd: "onLoaded",
    },
    "*"
  );
};
export const getInspectionId = (data) => {
  // 向前端发送请求获取人员
  window.parent.postMessage({ cmd: "inspectionId", param: data }, "*");
};
export const postPersonBoard = (id) => {
  window.parent.postMessage(
    {
      // 调用前端弹窗
      cmd: "personDetail",
      param: id,
    },
    "*"
  );
};
export const closeDialog = () => {
  window.parent.postMessage(
    {
      // 调用前端弹窗
      cmd: "closeDomDialog",
    },
    "*"
  );
};
export const postGatherList = (data) => {
  window.parent.postMessage(
    {
      // 调用前端弹窗
      cmd: "gatherCallBack",
      param: data,
    },
    "*"
  );
};
export const getPerson = (data) => {
  // 向前端发送请求获取人员
  window.parent.postMessage(
    {
      cmd: "get",
      param: data,
    },
    "*"
  );
};
export const changeIndoor = (data) => {
  // 向前端发送请求获取人员
  window.parent.postMessage(
    {
      cmd: "web3dChangeIndoor",
      param: data,
    },
    "*"
  );
};
export const getBuildingDetail = (id) => {
  window.parent.postMessage(
    {
      cmd: "buildingDetail",
      param: { id },
    },
    "*"
  );
};
export const dblclickBuilding = (data) => {
  // 向前端发送请求获取人员
  window.parent.postMessage(
    {
      cmd: "dbClickBuilding",
      param: data,
    },
    "*"
  );
};
export const getCameraVideo = (data) => {
  // 向前端发送请求获取人员
  window.parent.postMessage({ cmd: "cameraVideoId", param: data }, "*");
};
export const postBuildingId = (data) => {
  // 向前端发送点击的楼栋信息，前端查取楼栋人员
  window.parent.postMessage({ cmd: "switchByBuildingId", param: data }, "*");
};

export const gatherClick = (data) => {
  window.parent.postMessage(
    {
      // 点击聚集牌子
      cmd: "clickUnion",
      param: data, // 人员id
    },
    "*"
  );
};
export const web3dModelsGroup = (data) => {
  window.parent.postMessage(
    {
      cmd: "web3dModelsGroup",
      param: data,
    },
    "*"
  );
};

export const web3dSelectCode = (id) => {
  console.log("web3dSelectCode", id);
  window.parent.postMessage(
    {
      cmd: "web3dSelectCode",
      param: id, // 设备编号
    },
    "*"
  );
};

/**
 * 设备 Icon 类型归一化：水表一期/二期统一为 shuibiao
 * @param {string} type
 * @returns {string}
 */
export const normalizeDeviceIconType = (type) => {
  const t = String(type || "").split("_")[0];
  if (t === "shuibiao1" || t === "shuibiao2") return "shuibiao";
  return t;
};

/**
 * 三维点击设备 CSS2D icon → 通知父页面
 * @param {{ deviceType: string, deviceName: string }} data
 */
export const web3dDeviceIconClick = (data) => {
  const deviceType = normalizeDeviceIconType(data?.deviceType ?? "");
  const deviceName = data?.deviceName ?? "";
  console.log("web3dDeviceIconClick", deviceType, deviceName);
  window.parent.postMessage(
    {
      cmd: "web3dDeviceIconClick",
      param: {
        deviceType,
        deviceName,
      },
    },
    "*"
  );
};
