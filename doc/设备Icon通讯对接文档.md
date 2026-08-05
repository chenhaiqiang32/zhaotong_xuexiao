# 设备 Icon 通讯对接文档

父页面与三维页面通过 `postMessage` 通讯，消息体统一为：

```js
{ cmd: string, param?: any }
```

- 父页面 → 三维：`iframe.contentWindow.postMessage(payload, "*")`
- 三维 → 父页面：`window.parent.postMessage(payload, "*")`

---

## 1. 界面 → 三维：筛选设备 Icon

**命令**：`filterDeviceIcon`

**传参**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `deviceType` | `string` | `"all"` 显示全部；其它为设备类型 key（如 `menjin`） |

**调用示例**：

```js
// 显示全部 Icon
iframe.contentWindow.postMessage(
  { cmd: "filterDeviceIcon", param: { deviceType: "all" } },
  "*"
);

// 仅显示门禁 Icon
iframe.contentWindow.postMessage(
  { cmd: "filterDeviceIcon", param: { deviceType: "menjin" } },
  "*"
);
```

`deviceType` 可选值：`all` | `zhinengmensuo` | `LDXX` | `shuibiao` | `fangkeji` | `guangbo` | `jiankong` | `menjin` | `mensuo`  
（水表一期/二期统一传 `shuibiao`，点击回传也会归一为 `shuibiao`）

---

## 2. 三维 → 界面：点击设备 Icon

**命令**：`web3dDeviceIconClick`

**传参**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `deviceType` | `string` | 设备类型 |
| `deviceName` | `string` | 设备名称（编号） |

**调用示例（父页面监听）**：

```js
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.cmd !== "web3dDeviceIconClick") return;

  const { deviceType, deviceName } = data.param || {};
  // 示例回包：
  // {
  //   cmd: "web3dDeviceIconClick",
  //   param: { deviceType: "menjin", deviceName: "门禁设备编号" }
  // }
  console.log(deviceType, deviceName);
});
```
