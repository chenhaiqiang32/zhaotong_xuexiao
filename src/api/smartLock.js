import { http } from "./http";

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

/**
 * 接口1：分页查询门锁信息（当前接口不通：失败则自动回退 mock）
 */
export async function smartLockPage(params = {}) {
  try {
    const res = await http.post("/page", params);
    return res.data;
  } catch (e) {
    return await fetchMockJson("/mock/smart-lock-page.json");
  }
}

/**
 * 接口2：分页查询开门记录（当前接口不通：失败则自动回退 mock 并按参数过滤）
 */
export async function smartLockOpenLogPage(params = {}) {
  try {
    const res = await http.post("/pageOpenLog", params);
    return res.data;
  } catch (e) {
    const data = await fetchMockJson("/mock/smart-lock-openlog-page.json");
    return applyOpenLogMockQuery(data, params);
  }
}

