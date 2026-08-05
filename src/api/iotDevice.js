import { iotHttp, smartLockHttp } from "./iotHttp";

/** 设备类型 → 中文名（搜索面板 / 信息牌标题） */
export const DEVICE_TYPE_LABELS = {
  mensuo: "智能门锁(旧)",
  zhinengmensuo: "智能门锁",
  LDXX: "楼栋信息",
  shuibiao1: "水表一期",
  shuibiao2: "水表二期",
  fangkeji: "访客机",
  guangbo: "广播",
  jiankong: "监控",
  menjin: "门禁",
};

/** 图标路径（与 public/icons 一致；mensuo 兼容旧模型节点） */
export const DEVICE_ICON_SRC = {
  mensuo: "/icons/mensuo.png",
  zhinengmensuo: "/icons/zhinengmensuo.png",
  LDXX: "/icons/LDXX.png",
  shuibiao1: "/icons/shuibiao.png",
  shuibiao2: "/icons/shuibiao.png",
  fangkeji: "/icons/fangkeji.png",
  guangbo: "/icons/guangbo.png",
  jiankong: "/icons/jiankong.png",
  menjin: "/icons/menjin.png",
};

function stripDahuaSuffix(id) {
  const s = String(id || "");
  return s.endsWith("_dahua") ? s.slice(0, -"_dahua".length) : s;
}

function endsWithDahua(id) {
  return String(id || "").endsWith("_dahua");
}

async function fetchMockJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`mock 请求失败: ${path}`);
  return await res.json();
}

/**
 * 本地 mock：按 lockName、apartmentName 过滤（与文档示例一致，服务端为模糊；mock 用包含/相等匹配）
 */
function applyOpenLogMockQuery(mockData, params = {}) {
  const { lockName, apartmentName, pageNum = 1, pageSize = 12 } = params;
  const list0 = mockData?.result?.data?.list || [];
  let list = list0;
  if (lockName) {
    list = list.filter(
      (r) =>
        r.lockName === lockName ||
        (r.lockName && String(r.lockName).includes(String(lockName)))
    );
  }
  if (apartmentName) {
    list = list.filter(
      (r) =>
        r.apartmentName === apartmentName ||
        (r.apartmentName &&
          String(r.apartmentName).includes(String(apartmentName)))
    );
  }
  const start = (Number(pageNum) - 1) * Number(pageSize);
  const pageList = list.slice(start, start + Number(pageSize));
  return {
    ...mockData,
    result: {
      ...mockData.result,
      data: {
        ...mockData.result.data,
        total: list.length,
        list: pageList,
        pageNum: Number(pageNum),
        pageSize: Number(pageSize),
        pages: Math.max(1, Math.ceil(list.length / Number(pageSize))),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 旧门锁 JetLinks（mensuo）：失败自动回退 mock
// ---------------------------------------------------------------------------

/**
 * 接口1：分页查询门锁信息
 * POST /api/smart-lock/page
 */
export async function smartLockPage(params = {}) {
  try {
    const res = await smartLockHttp.post("/smart-lock/page", params);
    return res.data;
  } catch (e) {
    return await fetchMockJson("/mock/smart-lock-page.json");
  }
}

/**
 * 接口2：分页查询开门记录
 * POST /api/smart-lock/pageOpenLog
 */
export async function smartLockOpenLogPage(params = {}) {
  try {
    const res = await smartLockHttp.post("smart-lock/pageOpenLog", params);
    return res.data;
  } catch (e) {
    const data = await fetchMockJson("/mock/smart-lock-openlog-page.json");
    return applyOpenLogMockQuery(data, params);
  }
}

// ---------------------------------------------------------------------------
// IoT 设备接口（iot.niat.edu.cn）
// ---------------------------------------------------------------------------

/**
 * 智能门锁：按 sn 分页查询
 * POST /lock-device/page
 */
export async function lockDevicePage({ sn, pageNum = "1", pageSize = "10" } = {}) {
  const res = await iotHttp.post("/lock-device/page", {
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    sn: String(sn || ""),
  });
  return res.data;
}

/**
 * 楼栋信息 / 床位列表
 * POST /api/roomBed/list （完整路径含双 api，base 已含 /api）
 */
export async function roomBedList({ jzwid, fjid } = {}) {
  const res = await iotHttp.post("/api/roomBed/list", {
    jzwid: String(jzwid || ""),
    fjid: String(fjid || ""),
  });
  return res.data;
}

/**
 * 水表一期/二期
 * GET /energy/water-meters?propertyUid=
 */
export async function waterMetersByPropertyUid(propertyUid) {
  const res = await iotHttp.get("/energy/water-meters", {
    params: { propertyUid: String(propertyUid || "") },
  });
  return res.data;
}

/**
 * 大华设备详情（访客机 / 监控 / 门禁 _dahua）
 * GET /dahua-device/detail/{id}
 */
export async function dahuaDeviceDetail(deviceCode) {
  const id = stripDahuaSuffix(deviceCode);
  const res = await iotHttp.get(
    `/dahua-device/detail/${encodeURIComponent(id)}`
  );
  return res.data;
}

/**
 * 广播终端
 * GET /broadcast-terminal/terminals?endpointIdr=
 */
export async function broadcastTerminalsByEndpointId(endpointIdr) {
  const res = await iotHttp.get("/broadcast-terminal/terminals", {
    params: { endpointIdr: String(endpointIdr || "") },
  });
  return res.data;
}

/**
 * 门禁列表（非大华）
 * POST /access-control/water-list/list
 */
export async function accessControlWaterList({
  doorName,
  pageNum = 1,
  pageSize = 50,
} = {}) {
  const res = await iotHttp.post("/access-control/water-list/list", {
    pageNum: Number(pageNum) || 1,
    pageSize: Number(pageSize) || 50,
    doorName: String(doorName || ""),
  });
  return res.data;
}

/**
 * 按设备类型 + 图标编号调取对应 IoT 接口
 * @param {string} type 设备类型（模型节点名前缀）
 * @param {string} deviceId 点击图标得到的编号
 * @param {{ buildingId?: string, buildingName?: string }} ctx 楼栋上下文
 */
export async function fetchDeviceInfoByType(type, deviceId, ctx = {}) {
  const t = String(type || "").split("_")[0];
  const id = String(deviceId || "").trim();
  const buildingId = ctx.buildingId || ctx.buildingName || "";
  const buildingName = ctx.buildingName || buildingId;

  switch (t) {
    case "zhinengmensuo":
      return {
        api: "lock-device/page",
        data: await lockDevicePage({ sn: id }),
      };
    case "LDXX":
      return {
        api: "api/roomBed/list",
        data: await roomBedList({ jzwid: buildingId, fjid: id }),
      };
    case "shuibiao1":
    case "shuibiao2":
      return {
        api: "energy/water-meters",
        data: await waterMetersByPropertyUid(id),
      };
    case "fangkeji":
    case "jiankong":
      if (!endsWithDahua(id)) {
        return {
          api: "dahua-device/detail",
          data: null,
          meta: {
            skipped: true,
            reason: "设备编码未以 _dahua 结尾，不请求大华详情接口",
          },
        };
      }
      return {
        api: "dahua-device/detail",
        data: await dahuaDeviceDetail(id),
      };
    case "guangbo":
      return {
        api: "broadcast-terminal/terminals",
        data: await broadcastTerminalsByEndpointId(id),
      };
    case "menjin":
      if (endsWithDahua(id)) {
        return {
          api: "dahua-device/detail",
          data: await dahuaDeviceDetail(id),
        };
      }
      return {
        api: "access-control/water-list/list",
        data: await accessControlWaterList({ doorName: buildingName }),
      };
    default:
      return {
        api: null,
        data: null,
        meta: { skipped: true, reason: `未配置接口的设备类型: ${t}` },
      };
  }
}

// ---------------------------------------------------------------------------
// 信息牌字段：按接口文档转为中文 key / 枚举文案
// ---------------------------------------------------------------------------

function dash(v) {
  if (v == null || v === "") return "-";
  return String(v);
}

function mapEnum(v, dict) {
  if (v == null || v === "") return "-";
  const key = String(v);
  return dict[key] != null ? dict[key] : dash(v);
}

function online01(v) {
  return mapEnum(v, { 0: "离线", 1: "在线" });
}

function yesNo01(v) {
  return mapEnum(v, { 0: "否", 1: "是" });
}

function unwrapBizData(payload) {
  if (payload == null) return null;
  if (payload?.result?.data != null) return payload.result.data;
  if (payload?.data != null) return payload.data;
  return payload;
}

function firstListItem(data, predicate) {
  if (data == null) return null;
  let list = null;
  if (Array.isArray(data)) list = data;
  else {
    list =
      data.rows ||
      data.list ||
      data.records ||
      data.pageData ||
      data.content ||
      null;
  }
  if (Array.isArray(list)) {
    if (typeof predicate === "function") {
      const hit = list.find(predicate);
      if (hit) return hit;
    }
    return list[0] || null;
  }
  return data;
}

function pushRow(rows, label, value, { skipEmpty = true } = {}) {
  if (skipEmpty && (value == null || value === "" || value === "-")) return;
  rows.push([label, value == null || value === "" ? "-" : String(value)]);
}

/** 智能门锁 lock-device/page → data.rows[] */
function rowsFromLockDevice(payload, sn) {
  const rows = [];
  const item = firstListItem(unwrapBizData(payload), (r) =>
    sn ? String(r?.sn) === String(sn) : false
  );
  if (!item) return rows;
  pushRow(rows, "门锁名称", item.name);
  pushRow(rows, "门锁序列号", item.sn);
  pushRow(rows, "区域名称", item.areaName);
  pushRow(rows, "网关设备名称", item.devName);
  pushRow(rows, "网关设备序列号", item.devSn);
  pushRow(rows, "电量", item.eleAmount);
  pushRow(rows, "信号强度", item.rssi);
  pushRow(rows, "开门次数", item.openTimes);
  pushRow(rows, "网络状态", online01(item.networkState), { skipEmpty: false });
  pushRow(rows, "锁状态", item.lockState);
  pushRow(rows, "反锁状态", item.antilock);
  pushRow(rows, "锁舌状态", item.lockTab);
  pushRow(rows, "常开状态", item.constOpenState);
  pushRow(rows, "锁定状态", item.lockedState);
  pushRow(rows, "NFC 状态", item.nfcStatus);
  pushRow(rows, "无记录警告天数", item.noRecWarnDay);
  pushRow(rows, "设备类型", item.deviceType);
  pushRow(rows, "创建时间", item.createdTime);
  pushRow(rows, "更新时间", item.updatedTime);
  return rows;
}

/** 水表 energy/water-meters → data.list[] */
function rowsFromWaterMeter(payload, propertyUid) {
  const rows = [];
  const item = firstListItem(unwrapBizData(payload), (r) =>
    propertyUid ? String(r?.propertyUid) === String(propertyUid) : false
  );
  if (!item) return rows;
  pushRow(rows, "水表名称", item.meterName);
  pushRow(rows, "物业唯一编号", item.propertyUid);
  pushRow(rows, "物业表号", item.meterNo);
  pushRow(rows, "物业名称", item.propertyName);
  pushRow(
    rows,
    "累计流量(m³)",
    item.cumulativeFlow != null ? String(item.cumulativeFlow) : null
  );
  pushRow(rows, "采集时间", item.collectTime);
  pushRow(rows, "数据来源", item.dataSource);
  pushRow(rows, "口径", item.caliber);
  pushRow(rows, "计量范围", item.measureRange);
  pushRow(rows, "水表位置", item.location);
  pushRow(rows, "层级", item.level);
  pushRow(rows, "传输方式", item.transmission);
  pushRow(rows, "用水类型", item.waterUseType);
  pushRow(rows, "使用部门", item.department);
  pushRow(rows, "是否有压力计", item.hasPressureGauge);
  pushRow(rows, "备注", item.remark);
  return rows;
}

/** 大华设备详情（访客机 / 监控 / 门禁 _dahua） */
function rowsFromDahuaDevice(payload) {
  const rows = [];
  const item = firstListItem(unwrapBizData(payload));
  if (!item) return rows;
  pushRow(rows, "设备编码", item.deviceCode);
  pushRow(rows, "设备名称", item.deviceName);
  pushRow(rows, "设备标识码", item.deviceSn);
  pushRow(rows, "设备大类", item.deviceCategory);
  pushRow(rows, "设备小类", item.deviceType);
  pushRow(rows, "设备厂商", item.deviceManufacturer);
  pushRow(rows, "设备型号", item.deviceModel);
  pushRow(rows, "设备 IP", item.deviceIp);
  pushRow(rows, "设备端口", item.devicePort);
  pushRow(rows, "所属组织编码", item.ownerCode);
  pushRow(rows, "组织名称", item.orgName);
  pushRow(rows, "在线状态", online01(item.isOnline), { skipEmpty: false });
  pushRow(rows, "离线原因", item.offlineReason);
  pushRow(rows, "所属子系统", item.subSystem);
  pushRow(
    rows,
    "是否休眠",
    item.sleepStat != null ? mapEnum(item.sleepStat, { 0: "非休眠", 1: "休眠" }) : null
  );
  pushRow(
    rows,
    "加密狗是否到期",
    item.licenseLimit != null ? yesNo01(item.licenseLimit) : null
  );
  pushRow(rows, "经度", item.gpsX);
  pushRow(rows, "纬度", item.gpsY);
  if (item.createTime != null) {
    const ts = Number(item.createTime);
    pushRow(
      rows,
      "创建时间",
      Number.isFinite(ts) && ts > 1e11
        ? new Date(ts).toLocaleString("zh-CN")
        : dash(item.createTime)
    );
  }
  pushRow(rows, "在线状态更新时间", item.onlineUpdateTime);
  const units = Array.isArray(item.units) ? item.units : [];
  if (units.length) {
    const chNames = [];
    units.forEach((u) => {
      (u.channels || []).forEach((ch) => {
        if (ch?.channelName) chNames.push(ch.channelName);
      });
    });
    if (chNames.length) pushRow(rows, "通道名称", chNames.join("、"));
    pushRow(rows, "单元数", units.length);
  }
  return rows;
}

/** 广播终端 broadcast-terminal/terminals → data[] */
function rowsFromBroadcast(payload, endpointId) {
  const rows = [];
  const item = firstListItem(unwrapBizData(payload), (r) =>
    endpointId != null && endpointId !== ""
      ? String(r?.EndpointID) === String(endpointId)
      : false
  );
  if (!item) return rows;
  pushRow(rows, "终端 ID", item.EndpointID);
  pushRow(rows, "终端名称", item.EndpointName);
  pushRow(rows, "终端 IP", item.EndpointIP);
  pushRow(rows, "终端 MAC", item.EndpointMac);
  pushRow(rows, "终端型号", item.EndpointType);
  pushRow(rows, "终端型号名称", item.EndpointTypeName);
  pushRow(rows, "终端版本", item.EndpointVersion);
  pushRow(
    rows,
    "工作状态",
    mapEnum(item.Status, { 0: "离线", 1: "在线", 2: "占用" }),
    { skipEmpty: false }
  );
  pushRow(rows, "状态描述", item.StatusDsp);
  pushRow(rows, "音量", item.Volume);
  pushRow(rows, "终端呼叫码", item.CallCode);
  pushRow(rows, "中继服务器名称", item.ProxyServerName);
  pushRow(rows, "中继服务器 IP", item.ProxyServerIP);
  pushRow(rows, "任务名称", item.TaskName);
  pushRow(rows, "任务类型名称", item.TaskTypeName);
  pushRow(rows, "禁用标记", item.DisableFlag);
  return rows;
}

/** 门禁刷卡流水 access-control/water-list/list → data.list[] */
function rowsFromAccessWaterList(payload) {
  const rows = [];
  const data = unwrapBizData(payload);
  const list = Array.isArray(data?.list)
    ? data.list
    : Array.isArray(data)
      ? data
      : [];
  if (!list.length) return rows;

  pushRow(rows, "流水总条数", data?.total != null ? data.total : list.length, {
    skipEmpty: false,
  });

  const show = list.slice(0, 8);
  show.forEach((item, i) => {
    const inOut = mapEnum(item.inOutFlag, { 1: "进入", 0: "出去" });
    const name = item.studentName || "-";
    const time = item.accessTime || "-";
    pushRow(
      rows,
      `流水${i + 1}`,
      `${name} · ${inOut} · ${time}`,
      { skipEmpty: false }
    );
    if (i === 0) {
      pushRow(rows, "门 ID", item.doorId);
      pushRow(rows, "门读头 ID", item.doorReaderId);
      pushRow(rows, "控制器 ID", item.controllerId);
      pushRow(rows, "一卡通账号", item.cardAccount);
      pushRow(rows, "工作区 ID", item.workAreaId);
    }
  });
  if (list.length > show.length) {
    pushRow(rows, "更多", `另有 ${list.length - show.length} 条…`);
  }
  return rows;
}

/** 宿管房间床位 roomBed/list → result.data[] */
function rowsFromRoomBed(payload, fjid) {
  const rows = [];
  const data = unwrapBizData(payload);
  const buildings = Array.isArray(data) ? data : data ? [data] : [];
  if (!buildings.length) return rows;

  let b = buildings[0];
  let room = null;
  const wantFj = fjid != null && String(fjid).trim() !== "" ? String(fjid) : "";

  if (wantFj) {
    for (const building of buildings) {
      const rooms = Array.isArray(building.fj) ? building.fj : [];
      const hit = rooms.find((r) => String(r?.fjid) === wantFj);
      if (hit) {
        b = building;
        room = hit;
        break;
      }
    }
  }
  if (!room) {
    const rooms = Array.isArray(b.fj) ? b.fj : [];
    room = rooms[0] || null;
  }

  pushRow(rows, "楼栋名称", b.jzwmc);
  pushRow(rows, "楼栋 ID", b.jzwid);
  pushRow(rows, "地上层数", b.jzwdscs);
  pushRow(rows, "地下层数", b.jzwdxcs);
  pushRow(rows, "用途", b.jzwyt || b.jzwytm);
  pushRow(rows, "房间数", b.fjs);

  if (!room) {
    pushRow(rows, "房间", "暂无房间数据");
    return rows;
  }

  pushRow(rows, "房间名称", room.fjmc);
  pushRow(rows, "房间编号", room.fjbh);
  pushRow(rows, "房间 ID", room.fjid);
  pushRow(rows, "楼层号", room.fjlc);
  pushRow(rows, "房间用途码", room.fjytm);

  const beds = Array.isArray(room.cw) ? room.cw : [];
  pushRow(rows, "床位数", beds.length, { skipEmpty: false });
  beds.slice(0, 12).forEach((bed, i) => {
    const occ =
      bed.xm || bed.xh
        ? `${bed.xm || "-"}（${bed.xh || "-"}${bed.cwxskssj ? ` · ${bed.cwxskssj}` : ""}）`
        : "空闲";
    pushRow(rows, `床位${bed.cwmc || i + 1}`, occ, { skipEmpty: false });
  });
  if (beds.length > 12) {
    pushRow(rows, "更多床位", `另有 ${beds.length - 12} 个…`);
  }
  return rows;
}

/**
 * 将接口返回转为信息牌中文键值行
 * @param {string} type 设备类型
 * @param {{ api?: string, data?: any }} result fetchDeviceInfoByType 的返回
 * @param {{ deviceId?: string }} [ctx]
 * @returns {Array<[string, string]>}
 */
export function formatDeviceInfoRows(type, result = {}, ctx = {}) {
  const t = String(type || "").split("_")[0];
  const api = result?.api || "";
  const data = result?.data;
  const deviceId = ctx.deviceId;

  if (api === "lock-device/page" || t === "zhinengmensuo") {
    return rowsFromLockDevice(data, deviceId);
  }
  if (api === "energy/water-meters" || t === "shuibiao1" || t === "shuibiao2") {
    return rowsFromWaterMeter(data, deviceId);
  }
  if (api === "dahua-device/detail") {
    return rowsFromDahuaDevice(data);
  }
  if (api === "broadcast-terminal/terminals" || t === "guangbo") {
    return rowsFromBroadcast(data, deviceId);
  }
  if (api === "access-control/water-list/list") {
    return rowsFromAccessWaterList(data);
  }
  if (api === "api/roomBed/list" || t === "LDXX") {
    return rowsFromRoomBed(data, deviceId);
  }
  return [];
}

export { stripDahuaSuffix, endsWithDahua };
