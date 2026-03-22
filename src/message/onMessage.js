import Core from "../main";
import {
  doFenceData,
  equipData,
  inspectionData,
  personDangerData,
  gatherDangerDate,
  sceneChange,
  searchData,
  realTimeData,
  dangerHistoryData,
} from "../three/components/dataProgress";
import {
  SUNNY,
  RAIN,
  SNOW,
  DAY,
  NIGHT,
  SCIENCE,
} from "../three/components/weather";

// 因为管控部分版本没有更新，所以需要这个映射表
const TransformMap = {
  sunny: "SUNNY",
  rain: "RAIN",
  snow: "SNOW",
  day: "DAY",
  night: "NIGHT",
  science: "SCIENCE",
};

export const onMessage = async () => {
  // 动态导入所需的模块
  const [
    { SUNNY, RAIN, SNOW, DAY, NIGHT, SCIENCE },
    {
      doFenceData,
      equipData,
      inspectionData,
      personDangerData,
      gatherDangerDate,
      sceneChange,
      searchData,
      realTimeData,
      dangerHistoryData,
    },
  ] = await Promise.all([
    import("../three/components/weather"),
    import("../three/components/dataProgress"),
  ]);

  // 更新 TransformMap 的值
  Object.keys(TransformMap).forEach((key) => {
    TransformMap[key] = eval(TransformMap[key]);
  });

  // 等待 Store3D 实例初始化
  const waitForStore3D = () => {
    return new Promise((resolve) => {
      const checkStore3D = () => {
        if (window.Core) {
          resolve(window.Core);
        } else {
          setTimeout(checkStore3D, 100);
        }
      };
      checkStore3D();
    });
  };

  // 等待 Store3D 实例初始化完成
  const core = await waitForStore3D();

  // 添加防抖机制，避免频繁的场景切换
  let changeSceneTimeout = null;
  let lastChangeSceneParam = null;
  let lastChangeSceneTime = 0; // 记录上一次场景切换的时间
  let isChangingScene = false; // 标记是否正在切换场景

  window.addEventListener("message", (event) => {
    if (!core) {
      console.warn("Store3D 实例尚未初始化");
      return;
    }

    if (event.data && event.data.cmd) {
      switch (event.data.cmd) {
        case "changeLighting": {
          const param = TransformMap[event.data.param];
          if (!param) {
            console.warn("无效的光照参数:", event.data.param);
            return;
          }
          core.changeLighting(param);
          break;
        }
        case "changeWeather": {
          const param = event.data.param;
          if (!param || !param.type) {
            console.warn("无效的天气参数:", param);
            return;
          }
          core.ground.switchWeather({ type: param.type, level: param.level });
          break;
        }
        case "setBuildingShellTransparent": {
          const p = event.data.param;
          const on =
            p === true ||
            p === "true" ||
            p === 1 ||
            (typeof p === "object" && p && p.transparent === true);
          core.ground.setBuildingShellTransparent(on);
          break;
        }
        case "toggleBuildingShellTransparent": {
          core.ground.toggleBuildingShellTransparent();
          break;
        }
        case "close": {
          core._stopRender();
          break;
        }
        case "open": {
          core._beginRender();
          break;
        }
        case "setCameraState": {
          core.setCameraState(event.data.param);
          break;
        }
        case "changeSystem": {
          core.changeSystem(event.data.param);
          break;
        }
        case "changeScene": {
          // 防抖处理：如果参数相同且时间间隔很短，则忽略
          const currentParam = event.data.param;
          const now = Date.now();

          // 如果正在切换场景，直接忽略
          if (isChangingScene) {
            console.log("正在切换场景，忽略重复请求:", currentParam);
            return;
          }

          if (changeSceneTimeout) {
            clearTimeout(changeSceneTimeout);
          }

          if (
            lastChangeSceneParam === currentParam &&
            now - (lastChangeSceneTime || 0) < 1000 // 增加到1秒
          ) {
            console.log("忽略重复的场景切换请求:", currentParam);
            return;
          }

          lastChangeSceneParam = currentParam;
          lastChangeSceneTime = now;
          isChangingScene = true;

          changeSceneTimeout = setTimeout(() => {
            console.log("执行场景切换:", currentParam);
            if (currentParam === "地面") {
              core.changeSystem("ground");
            } else {
              core.changeSystem("indoorSubsystem", currentParam);
            }

            // 切换完成后重置标记
            setTimeout(() => {
              isChangingScene = false;
            }, 500); // 500ms后允许下一次切换
          }, 200); // 增加到200ms防抖延迟
          break;
        }
        case "setWanderState": {
          if (event.data.param) {
            core.beginWander();
          } else {
            core.endWander();
          }
          break;
        }
        case "startMeasuring": {
          core.startMeasuring();
          break;
        } // 开启测距

        case "removeMeasuring": {
          core.removeMeasuring();
          break;
        } // 关闭测距

        case "startMeasureArea": {
          core.startMeasureArea();
          break;
        } // 开启测面积

        case "removeMeasureArea": {
          core.removeMeasureArea();
          break;
        } // 清除测面积

        // 设置热力图
        case "setHeatmap": {
          core.setHeatmap(event.data.param);
          break;
        }

        case "init": {
          core.orientation.init(event.data.param);
          let followId = core.orientation.followId; // 跟踪信息
          if (followId) {
            core.followCheck(event, followId);
          }
          break;
        }

        case "getInspectin": {
          // 获取巡检点的数据
          let inspection = inspectionData(event.data.param);
          core.search(inspection);

          break;
        }
        case "removeInset": {
          // 清除设备
          core.clearEquipType(event.data.param);
          break;
        }
        case "getCameraList": {
          const { data } = event.data.param;
          let cameraData = equipData(data); // 数据处理
          core.processingEquipment(cameraData, "camera");
          break;
        } // 摄像头的列表
        case "inspectionSystem_initialData": // 巡检系统
          let data = equipData(event.data.param); // 数据处理
          core.processingEquipment(data, "inspectionSystem");
          break;
        case "hideInspectionSystemIcon": {
          core.hideInspectionSystemIcon(event.data.param);
        }
        case "getBeaconList": {
          const { data } = event.data.param;
          let beaconData = equipData(data); // 数据处理
          core.processingEquipment(beaconData, "beacon");
          break;
        } // 星标列表

        case "trackInit":
        case "trackStart":
        case "trackStop":
        case "trackSpeedUp":
        case "trackSpeedDown":
        case "trackProgress":
        case "trackAngleSwitch":
        case "trackClear": {
          core.historyTrackCommand(event.data);
          break;
        } // 清除

        case "buildingNumber": {
          let buildingNumber = event.data.param;
          core.changeBuildingNum(buildingNumber);
          break;
        } // 改变建筑牌子上显示的人员数据

        case "buildingList": {
          const data = event.data.param;
          // console.log(data);
          break;
        }

        case "cherryPick": {
          core.cherryPick(event.data.param); // 筛选
          break;
        }

        case "startSelect": {
          core.changeBoxSelect(event.data.param); // 框选
          break;
        }

        case "reSelect": {
          core.reSelect();
          break;
        }

        // todo fenceList 需要等前端弄好后重新调整
        case "fenceList": {
          event.data.param.data.map((child) => {
            const { id, name, type } = child;
            let fenceDataNew = doFenceData(child);

            let fenceObj = {
              fenceData: fenceDataNew,
              id,
              name,
              type: "area",
            };
            core.createFence(fenceObj); //
          });
          break;
        } // 围栏列表

        case "resetCamera": {
          // 执行重置视角功能
          console.log("执行重置视角功能");
          core.resetCamera();
          break;
        }
        case "autoRoute": {
          // 开启关闭自转功能
          const enabled = event.data.param; // true开启自转，false关闭自转
          console.log(`收到自转控制命令: ${enabled ? "开启" : "关闭"}`);
          core.setAutoRotate(enabled);
          break;
        }
        case "startSearch": {
          let data = searchData(event.data.param); // 数据处理
          core.search(data);
          break;
        }
        case "closeDialog": {
          // 关闭人员弹窗
          if (core.isIndoorModel()) {
            core.hideBuildingDialog();
            core.setIndoorModel(false);
          }
          let personId = event.data.param;
          if (!core.ground.boxSelectStatus) {
            // 不是框选状态
            core.bindGroundEvent();
          }

          core.clearSelected(personId);
          break;
        }

        case "personFollow":
          const { id, sceneType, originId } = event.data.param;
          let sceneChangeType = sceneChange({ sceneType, originId });

          core.startFollow({ id, originId, sceneType, sceneChangeType });
          break;
        case "removePersonFollow": {
          // 解除跟踪
          core.bindSearchEvent(); // 绑定搜索事件
          core.cancelFollow();
          break;
        }
        case "changeBuildingFloor": {
          // 切换楼层
          core.changeFloor(event.data.param);
          // Store3D.changeFloor(event.data.param);
          break;
        }
        case "changeIndoor": {
          core.changeIndoor(event.data.param);
          break;
        }
        case "goBack": {
          core.changeSystem("ground");

          break;
        }
        case "removeAllPerson": {
          // 清除所有的人
          core.clearAllPerson();
          break;
        }
        case "personDanger": {
          // 人员报警
          let dangerData = personDangerData(event.data.param); // 数据处理
          core.search(dangerData);
          break;
        }
        case "areaDanger": {
          // 区域报警
          const { fenceData, id, name, type, originId, sceneType } =
            event.data.param;
          let fenceDataNew = doFenceData(event.data.param);
          let fenceObj = {
            fenceData: fenceDataNew,
            id,
            name,
            type: "danger",
          };
          core.dangerFenceInit(fenceObj);
          break;
        }
        case "clearDanger": {
          // 清除报警
          core.clearDanger();
          break;
        }
        case "closeBuildingDialog": {
          // 关闭建筑弹窗
          let buildingId = event.data.param;
          core.bindGroundEvent();
          core.hideBuildingDialog(buildingId);
          break;
        }
        case "closeCameraDialog": {
          // 关闭设备弹窗
          if (core.isIndoorModel()) {
            core.hideBuildingDialog();
            core.setIndoorModel(false);
          }
          let cameraId = event.data.param;
          core.bindGroundEvent();
          core.hideCameraDialog(cameraId);
          break;
        }
        case "hideCameraIcon": {
          // 如果显示了未筛选的相机时候触发
          core.hideCameraById(event.data.param);
          break;
        }
        case "mouseEventSwitch":
          core.changeMouseEventSwitch(event.data.param);
          break;
        case "switchGather": {
          // 切换聚集
          core.switchGatherStatus(event.data.param);
          break;
        }
        case "setGatherLevel": {
          // 设置聚集等级
          core.setGatherLevel(event.data.param);
          break;
        }
        case "roamEnabled": {
          core.roamEnabled(event.data.param);
          break;
        }
        case "roamDuration": {
          core.roamDuration(event.data.param);
          break;
        }

        case "gatherDanger": {
          // 聚集报警
          let data = gatherDangerDate(event.data.param);
          core.gatherWarning.gatherDanger(data);
          break;
        }
        case "gatherNow": {
          // 聚集报警
          let data = realTimeData(event.data.param);
          core.gatherWarning.realTimeGather(data);
          break;
        }
        case "clearGatherDanger": {
          core.gatherWarning.disposeGather();
          break;
        }
        case "factoryChange": {
          let clearFence = core.currentSystem.clearBuildingFence
            ? core.currentSystem.clearBuildingFence.bind(core.currentSystem)
            : null;
          clearFence && clearFence();

          const data = doFenceData(event.data.param[0]);

          const { id, name, type } = event.data.param[0];
          // 厂区切换只有一组数据
          let fenceObj = {
            fenceData: data,
            id,
            name,
            type: "building",
          };

          core.createFence(fenceObj); //
          break;
        }
        case "gatherOrSilentArea": {
          // 聚集预警/静默 区域
          event.data.param.forEach((param) => {
            param.areaDataOut.push(param.areaDataOut[0]);
            core.ground.gatherOrSilentPlate.create(param); // 地面广场创建预警区域
            if (param.areaType === 3) {
              // 室内楼层预警
              core.indoorSubsystem.setFloorGatherOrSilent(param);
            }
          });
          break;
        }
        case "clearGatherOrSilentArea": {
          core.ground.gatherOrSilentPlate.dispose();
          core.indoorSubsystem.disposeGatherOrSilent();
          break;
        }
        case "escapeRoute": {
          core.ground.escapeRoute.init(event.data.param);
          break;
        }
        case "clearEscapeRoute": {
          core.ground.escapeRoute.dispose();
          break;
        }
        case "meetingPoint": {
          event.data.param.forEach((child, index) => {
            core.ground.meetingPoint.create({
              id: index,
              name: String(index),
              position: child,
            });
          });
          break;
        }
        case "webUpdateModel": {
          // 处理设备模型更新
          if (core.indoorSubsystem) {
            // 直接调用更新方法，该方法会清除旧数据并重新生成所有牌子
            core.indoorSubsystem.updateDeviceLabels(event.data.param);
          }
          break;
        }
        case "clearDeviceLabels": {
          // 清除设备标签和实例数据
          if (core.indoorSubsystem) {
            const deviceCodes =
              event.data.param && event.data.param.deviceCodes;
            core.indoorSubsystem.clearDeviceLabelsAndInstance(deviceCodes);
          }
          break;
        }
        case "checkStorageStatus": {
          // 检查存储状态
          if (core.indoorSubsystem) {
            console.log("=== 存储状态检查 ===");
            console.log(
              "当前楼层:",
              core.indoorSubsystem.currentFloor
                ? core.indoorSubsystem.currentFloor.name
                : "null"
            );
            console.log("存储的数据:", core.indoorSubsystem.deviceLabelsData);
            console.log(
              "设备标签数量:",
              core.indoorSubsystem.deviceLabels
                ? core.indoorSubsystem.deviceLabels.length
                : 0
            );
            console.log("==================");
          }
          break;
        }
        case "handleDeviceClick": {
          // 处理设备点击事件
          const deviceCode = event.data.param;
          if (!deviceCode) {
            console.warn("设备点击指令缺少设备名称参数");
            return;
          }

          console.log(`收到设备点击指令，设备名称: ${deviceCode}`);

          if (core.indoorSubsystem) {
            // 调用室内子系统的设备点击处理方法
            core.indoorSubsystem
              .handleDeviceClick(deviceCode)
              .catch((error) => {
                console.error("处理设备点击时发生错误:", error);
              });
          } else {
            console.warn("室内子系统未初始化，无法处理设备点击");
          }
          break;
        }
        case "updateDesign": {
          // 更新工艺和工艺牌子颜色
          const designData = event.data.param;
          if (!Array.isArray(designData)) {
            console.warn("updateDesign 参数格式错误，应为数组");
            return;
          }

          console.log("收到更新设计指令:", designData);

          // 室内场景处理
          if (core.indoorSubsystem) {
            core.indoorSubsystem.updateDesign(designData);
          }

          // 室外场景处理
          if (core.ground) {
            core.ground.updateDesign(designData);
          }

          break;
        }
      }
    }
  });
};
