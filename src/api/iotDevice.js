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

export { stripDahuaSuffix, endsWithDahua };
