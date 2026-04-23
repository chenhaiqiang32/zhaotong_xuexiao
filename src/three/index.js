import * as THREE from "three";
import { CoreExtensions } from "./core/CoreExtensions";
import { Ground, IndoorSubsystem, Subsystem } from "./subsystem";

import { shaderUpdateTime } from "../shader/funs";
import { TweenControls } from "../lib/tweenControls";

import { Orientation } from "./components/Orientation/Orientation";
import { CrossSearch } from "./components/crossSearch";
import { sceneChange } from "./components/dataProgress";
import { GatherWarning } from "./components/gather/GatherWarning";
import { globalAnimationManager } from "./loader";

let rightMouseupTime = 0;
let leftMouseupTime = 0;
const mousedown = new THREE.Vector2();
const mouseup = new THREE.Vector2();
let clickTimer = null;

export class Store3D extends CoreExtensions {
  static Default = {
    position: new THREE.Vector3(154, 265, 612),
    target: new THREE.Vector3(-446, 10, -389),
  };

  constructor(domElement) {
    super(domElement);

    this.time = new Date().getTime();

    this.cache = true;

    /**@type {Subsystem} currentSystem */
    this.currentSystem = null;

    this.firstLoad = true;
    this.sceneType = 1; // 0 室内、1室外

    this.dwObj = {}; // 储存定位原点的对象
    this.ray = new THREE.Raycaster();
    this.inDoorModel = false; // 是否搜索了未建模的建筑

    const __position = Store3D.Default.position
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), 45)
      .multiplyScalar(0.25);

    this.camera.position.copy(__position);
    this.controls.target.copy(Store3D.Default.target);

    this.controls.minDistance = 0;
  }

  setIndoorModel(state) {
    this.inDoorModel = state;
  }

  isIndoorModel() {
    return this.inDoorModel;
  }

  init() {
    // 添加CSS2DRenderer
    this.initCSS2DRenderer();
    this.initCSS3DRenderer();

    // 添加后处理
    this.initComposer();

    // this.cameraMoveLimit();
    this._beginRender();

    //  绑定控制器相关事件
    this.controlEvent();
  }

  _beginRender() {
    if (this.renderEnabled) return;
    if (this.firstLoad) {
      this.setClass();
      this.firstLoad = false;
    } else {
      this.currentSystem.onEnter();
    }
    this.beginRender();
  }

  _stopRender() {
    this.stopRender();
    this.currentSystem.onLeave();
  }

  setClass() {
    // 相机控制
    this.tweenControl = new TweenControls(this);

    this.orientation = new Orientation(this);

    // this.initStats(); //todo 帧数检测

    this.ground = new Ground(this);
    // 室内
    this.indoorSubsystem = new IndoorSubsystem(this);

    // 切换场景首次
    this.crossSearch = new CrossSearch(this);

    this.gatherWarning = new GatherWarning(this);

    this.changeSystem("ground");

    this.onRenderQueue.set("elapsedTimeUpdate", (scope) =>
      shaderUpdateTime(scope.elapsedTime)
    );

    // 添加全局动画管理器更新
    this.onRenderQueue.set("globalAnimationUpdate", () =>
      globalAnimationManager.update()
    );
  }

  hideInspectionSystemIcon(param) {
    this.currentSystem.hideInspectionSystemIcon(param);
  }

  isSearching() {
    return !!this.orientation.searchId;
  }

  isFollowing() {
    return !!this.orientation.followId;
  }

  cherryPick(data) {
    // 筛选功能
    this.currentSystem.cherryPick(data);
  }

  createFence(fences) {
    this.currentSystem.createFence && this.currentSystem.createFence(fences);
  }

  /**@description 各个系统模块切换 */
  async changeSystem(systemType, building = null) {
    // 销毁fence
    this.clearFence();
    this.changeSystemCommon(systemType);

    this.orientation.clearSearch();

    const targetSystem = this[systemType];
    await targetSystem.onEnter(building);
  }
  async changeIndoor(name) {
    // 根据传入的建筑名称从配置中获取对应的路径和楼层信息
    const buildingConfig = window.floorToName[name];

    if (!buildingConfig) {
      console.warn(`未找到建筑 "${name}" 的配置信息`);
      return;
    }

    const { path, floor } = buildingConfig;

    // 从路径中提取建筑名称（去掉 "inDoor/" 前缀和 "_室内" 后缀）
    // 例如: "inDoor/1楼_室内" -> "1楼"
    const buildingName = path.replace("inDoor/", "").replace("_室内", "");

    // 检查当前是否已经在室内系统
    const isCurrentlyIndoor = this.currentSystem === this.indoorSubsystem;

    // 如果当前已经在室内系统，检查是否是同一个楼栋
    if (isCurrentlyIndoor) {
      // 检查当前楼栋名称是否与目标楼栋相同
      const isSameBuilding = this.indoorSubsystem.buildingName === buildingName;

      if (isSameBuilding) {
        console.log(
          `当前已在室内系统且是同一个楼栋 "${buildingName}"，直接切换到楼层 ${floor}`
        );
        // 直接切换到指定楼层，无需重新加载楼栋
        this.changeFloor(floor);
        return;
      } else {
        console.log("当前已在室内系统但楼栋不同，执行清理操作");
        // 使用公共清理方法
        this.indoorSubsystem.clearIndoorData();

        // 重置相机位置到默认状态，避免位置冲突
        this.camera.position.set(0, 10, 20);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
      }
    }

    // 切换到室内系统
    await this.changeSystem("indoorSubsystem", buildingName);

    // 等待室内系统加载完成后切换到指定楼层
    // 使用 Promise 确保加载完成后再切换楼层
    const waitForIndoorLoad = () => {
      return new Promise((resolve) => {
        const checkLoaded = () => {
          if (
            this.indoorSubsystem &&
            this.indoorSubsystem.building &&
            this.indoorSubsystem.buildingObject &&
            this.indoorSubsystem.buildingObject[floor]
          ) {
            resolve();
          } else {
            setTimeout(checkLoaded, 100);
          }
        };
        checkLoaded();
      });
    };

    waitForIndoorLoad().then(() => {
      // 切换到指定楼层
      this.changeFloor(floor);
    });
  }

  /**
   * 从楼层节点名解析楼栋名（如 A01B001F03 -> A01B001），对应 models/inDoor/{楼栋}.glb
   */
  static extractBuildingFromFloorKey(floorFullName) {
    const s = String(floorFullName);
    const m = s.match(/^(.+)(F\d{2})$/i);
    if (m) return m[1];
    return s;
  }

  waitUntilIndoorFloorReady(floorFullName, timeoutMs = 60000) {
    const indoor = this.indoorSubsystem;
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (
          indoor.building &&
          indoor.buildingObject &&
          indoor.buildingObject[floorFullName]
        ) {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error(`室内楼层 ${floorFullName} 未就绪`));
        } else {
          setTimeout(tick, 100);
        }
      };
      tick();
    });
  }

  /**
   * 进入指定楼栋并切换到楼层（不依赖 window.floorToName，供设备搜索等按「完整楼层名」导航）
   */
  async enterIndoorAndFloor(buildingName, floorFullName) {
    const indoor = this.indoorSubsystem;
    if (this.currentSystem === indoor && indoor.buildingName === buildingName) {
      await indoor.changeFloor(floorFullName);
      return;
    }
    await this.changeSystem("indoorSubsystem", buildingName);
    await this.waitUntilIndoorFloorReady(floorFullName);
    await indoor.changeFloor(floorFullName);
  }

  /**
   * 按设备类型（如 mensuo）与设备编号搜索室外设备索引，进入对应楼层并拉近视角、选中样式
   */
  async focusDeviceByTypeAndId(deviceType, deviceId) {
    const found = this.ground.findDeviceIconByTypeAndId(deviceType, deviceId);
    if (!found) {
      console.warn(
        `[focusDeviceByTypeAndId] 未找到设备 type=${deviceType} id=${deviceId}`
      );
      return false;
    }
    const { floor, label } = found;
    const buildingName = Store3D.extractBuildingFromFloorKey(floor);
    await this.enterIndoorAndFloor(buildingName, floor);
    this.indoorSubsystem.focusDeviceIconLabel(label);
    return true;
  }

  clearFence() {
    if (this.currentSystem && this.currentSystem.clearFence) {
      this.currentSystem.clearFence();
    }
  }

  clearEquipType(typeArray) {
    this.currentSystem.clearEquipType(typeArray);
  }

  changeSystemCommon(systemType) {
    /**@type {Subsystem} */
    const targetSystem = this[systemType];
    const currentSystem = this.currentSystem;

    if (!targetSystem) {
      console.warn(`${systemType}子系统未初始化`);
      return;
    }

    if (currentSystem) {
      // 如果是同一个系统，但需要重新初始化（比如室内到室内的切换）
      if (targetSystem === currentSystem) {
        // 对于室内系统，允许重新初始化
        if (systemType === "indoorSubsystem") {
          console.log("室内系统重新初始化 - 执行完整清理");
          // 强制调用 onLeave 进行完整清理，防止资源累积
          currentSystem.onLeave();

          // 清理渲染队列
          if (this.onRenderQueue) {
            this.onRenderQueue.delete("indoorSubsystem");
          }

          // 清理场景提示
          if (this.indoorSubsystem.sceneHint) {
            this.indoorSubsystem.sceneHint.hide();
          }

          // 重置控制器状态
          this.indoorSubsystem.resetControls();
        } else {
          return; // 其他系统相同则不处理
        }
      } else {
        currentSystem.onLeave();
      }
    }

    this.orientation.orientation3D.disposeClusterGroup();
    this.orientation.orientation3D.disposeAlarm();

    this.changeScene(targetSystem.scene);
    this.currentSystem = targetSystem;
    this.sceneType =
      systemType === "ground"
        ? Orientation.SCENE_TYPE.OUTDOOR
        : Orientation.SCENE_TYPE.INDOOR;
  }

  /**
   * @description 各个系统模块切换适用于搜索跟踪等情况下的切换
   * @param {string} sceneChangeType - 第一个参数切换状态
   */
  async changeSystemCustom(sceneChangeType, originId, sceneType) {
    // 执行切换系统
    const systemType =
      sceneType === Orientation.SCENE_TYPE.INDOOR
        ? "indoorSubsystem"
        : "ground";
    this.changeSystemCommon(systemType);

    const targetSystem = this[systemType];
    if (sceneChangeType === "inToOut") {
      // 如果是 室内 => 室外 ，执行 onEnter 函数
      await targetSystem.onEnter();
    } else {
      // 如果是另外情况， 执行以下方法
      await targetSystem.onChangeSystemCustom(
        sceneChangeType,
        originId,
        originId.slice(0, -3)
      );
    }
  }

  controlEvent() {
    // 改变控制器时禁用射线事件,防止卡顿
    this.controls.addEventListener("start", () => {
      this.setRaycasterState("mousemove", false);
    });
    this.controls.addEventListener("end", () => {
      this.setRaycasterState("mousemove", true);
    });
  }

  getCurrentOriginId() {
    return {
      sceneType: this.sceneType,
      originId: this.indoorSubsystem.currentFloor
        ? this.indoorSubsystem.currentFloor.name
        : "",
    };
  }

  setHeatmap(bool) {
    this.orientation.setHeatmap(bool);
  }

  changeScene(scene) {
    this.scene = scene;
  }

  changeWeather(param) {
    this.currentSystem.changeWeather(param);
  }
  switchWeather(param) {
    this.ground.switchWeather(param);
  }

  changeFloor(type) {
    // this.indoorSubsystem && this.indoorSubsystem.testAnimate(type);
    this.indoorSubsystem && this.indoorSubsystem.changeFloor(type);
  }

  /**开启测量功能,所有功能依赖当前所处系统 */
  startMeasuring() {
    this.changeView(new THREE.Vector3(0, 1, 0), 1200);
    this.enableControlsRotate(false);
    this.currentSystem.startMeasuring();
    this.setCameraState(false);
  }

  /**移除测量功能,所有功能依赖当前所处系统 */
  removeMeasuring() {
    this.enableControlsRotate(true);
    this.currentSystem.removeMeasuring();
    this.setCameraState(this.ground.roamEnabled);
  }

  /**开启测面积功能,所有功能依赖当前所处系统 */
  startMeasureArea() {
    this.changeView(new THREE.Vector3(0, 1, 0), 1200);
    this.enableControlsRotate(false);
    this.currentSystem.startMeasureArea();
    this.setCameraState(false);
  }

  /**移除测面积功能,所有功能依赖当前所处系统 */
  removeMeasureArea() {
    this.currentSystem.removeMeasureArea();
    this.enableControlsRotate(true);
    this.setCameraState(this.ground.roamEnabled);
  }

  changeBoxSelect(status) {
    console.log("test");
    this.changeView(new THREE.Vector3(0, 1, 0), 1200);
    this.enableControlsRotate(!status);
    this.ground.changeBoxSelect(status);
    if (status) {
      this.setCameraState(false);
    } else {
      this.setCameraState(this.ground.roamEnabled);
    }
  }

  reSelect() {
    this.ground.boxSelect.end();
    this.ground.boxSelect.start();

    this.changeView(new THREE.Vector3(0, 1, 0), 1200);
    this.enableControlsRotate(false);
    this.setCameraState(false);
  }

  changeView(view = new THREE.Vector3(0, 1, 0), length = 100) {
    const position = new THREE.Vector3().addScaledVector(view, length);

    this.camera.position.copy(position);

    // this.camera.up.set(0,0,1);

    this.controls.target.set(0, 0, 0);
  }

  resetCameraUp() {
    this.camera.up.set(0, 1, 0);
  }

  enableControlsRotate(bool) {
    this.controls.enableRotate = bool;
  }

  historyTrackCommand(param) {
    this.currentSystem.historyTrackCommand(param);
  }

  clearSearch() {
    // let currentSearchPersonId = this.orientation.searchId;
    // let currentSearchBuildingId = null;
    // if (this.sceneType === 1) {
    //   currentSearchBuildingId = this.ground.searchBuildingId;
    // }
    // let currentSearchEquipId = this.currentSystem.getSearchEquipId();
    // if (currentSearchPersonId)
    //   this.currentSystem.clearSelected(currentSearchPersonId); // 关闭人员弹窗
    // if (currentSearchEquipId)
    //   this.currentSystem.clearCameraVideo(currentSearchEquipId); // 关闭摄像头的牌子
    // if (currentSearchBuildingId)
    //   this.hideBuildingDialog(currentSearchBuildingId); // 关闭建筑弹窗
  }

  async searchPerson(data) {
    const { originId, sceneType, sceneChangeType, id } = data;
    if (sceneChangeType !== "noChange") {
      // 场景切换后执行搜索
      await this.changeSystemCustom(sceneChangeType, originId, sceneType);
      this.crossSearch.setCrossSearchId = id;
      this.crossSearch.setCrossSearchStatus(true); // 记录跨场景的搜索
    } else {
      this.orientation.setSearchId(id);
      this.orientation.search();
      this.orientation.personSearchModule.setPosition();
    }
  }

  followCheck(event, followId) {
    // 有跟踪的人
    let currentFollowPersonInfo =
      event.data.param.update.length &&
      event.data.param.update.filter((child) => {
        if (child.id === followId) {
          return child;
        }
      });
    if (!currentFollowPersonInfo || currentFollowPersonInfo.length === 0) {
      return false;
    }
    let { id, sceneType, originId } = currentFollowPersonInfo[0];
    if (sceneType === 0 && !originId.includes("F")) {
      // 进入未建模的建筑
      sceneType = 1; // 进入未建模的建筑，统一切换到室外
    }

    let sceneChangeType = sceneChange({ sceneType, originId });
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      this.orientation.cancelFollow();
      this.followChangeScene({ originId, sceneType, sceneChangeType, id });
    }
  }

  async followChangeScene({ originId, sceneType, sceneChangeType, id }) {
    await this.changeSystemCustom(sceneChangeType, originId, sceneType);
    this.crossSearch.setCrossFollowId = id;
    this.crossSearch.setCrossFollowStatus(true); // 记录跨场景的搜索
  }

  async startFollow(data) {
    this.postprocessing.clearOutlineAll(1);

    // 开始跟踪
    const { sceneChangeType, id } = data;
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      await this.followChangeScene(data);
    }
    if (sceneChangeType === "noChange") {
      // 直接搜索
      this.currentSystem.startFollowPerson(id);
    }
  }

  cancelFollow() {
    // onMessage取消跟踪
    this.currentSystem.cancelFollowPerson();
    if (this.sceneType === 0) {
      // 取消跟踪室内需要绑定事件
      this.indoorSubsystem.removeEventListener();
      this.indoorSubsystem.addPointerLister();
      this.indoorSubsystem.addIndoorEvent();
      this.indoorSubsystem.addRightDbClickReset();
    }
  }

  changeMouseEventSwitch(bool) {
    if (!!bool) {
      this.currentSystem.addEventListener();
    } else {
      this.currentSystem.removeEventListener();
      this.postprocessing.clearOutlineAll(1);
      this.postprocessing.clearOutlineAll(2);
    }
  }

  bindGroundEvent() {
    // 绑定地面广场事件
    if (this.sceneType === 1) {
      this.ground.removeEventListener();
      this.ground.addEventListener();
    }
  }

  bindSearchEvent() {
    // 绑定地面搜索事件
    if (this.sceneType === 1) {
      this.ground.removeEventListener();
      this.ground.addGroundEvent();
    }
  }

  clearSelected(id) {
    // onMessage前端弹窗关闭后触发
    this.currentSystem.clearSelected(id);
  }

  clearAllPerson() {
    // 清空所有的人
    this.currentSystem.clearPerson();
  }

  dangerFenceInit(data) {
    this.ground.initDangerFence(data);
  }

  hideBuildingDialog(id) {
    this.ground.hideBuildingLabel(id);
  }

  hideCameraDialog(id) {
    this.currentSystem.clearCameraVideo(id); // 关闭摄像头的牌子
  }

  clearDanger() {
    // 清除报警
    if (this.orientation.orientation3D.personDangerData) {
      this.currentSystem.clearDangerPerson();
    }
    this.ground.clearDangerFence();
  }

  async personAlarmInit(data) {
    const { originId, sceneType, sceneChangeType, id } = data;
    this.currentSystem.setDangerPerson(data); // 存储报警人员信息
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      await this.changeSystemCustom(sceneChangeType, originId, sceneType);
      this.crossSearch.setCrossSearchDangerPersonStatus(true); // 记录跨场景的搜索
    }
    if (sceneChangeType === "noChange") {
      // 直接搜索
      this.currentSystem.searchAlarmPerson();
    }
  }

  changeBuildingNum(obj) {
    this.ground.changeBuildingNumber(obj);
  }

  hideCameraById(id) {
    // 隐藏指定相机
    this.currentSystem.hideCameraById(id);
  }

  switchGatherStatus(status) {
    // 开启关闭聚集
    this.orientation.clusterModule.setActive(status);
  }

  setGatherLevel(num) {
    // 设置聚集等级
    this.orientation.clusterModule.setLevel(num);
  }

  roamEnabled(value) {
    // 漫游开启关闭
    this.ground.roamEnabled = value;
    this.ground.setCameraState(value);
  }

  roamDuration(num) {
    // 漫游间隔
    this.ground.roamDuration = num;
  }

  /**
   * 设置自转功能
   * @param {boolean} enabled - true开启自转，false关闭自转
   */
  setAutoRotate(enabled) {
    console.log(`设置自转功能: ${enabled ? "开启" : "关闭"}`);

    if (enabled) {
      // 开启自转
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 2.0; // 设置自转速度
      console.log("自转功能已开启");
    } else {
      // 关闭自转
      this.controls.autoRotate = false;
      console.log("自转功能已关闭");
    }
  }

  /**
   *
   * @param {String} data originId
   * @param {Boolean} showVisible 未建模的建筑false
   */
  searchBuilding(data, showVisible) {
    // 搜索建筑
    this.ground.searchBuildingId = data; // 存入搜索数据
    if (this.sceneType === 0) {
      // 当前室内
      this.changeSystem("ground");
      this.crossSearch.setCrossSearchBuildingStatus(true); // 记录跨场景的搜索
    } else {
      // 当前室外
      this.ground.searchBuilding(showVisible);
    }
  }

  async searchCamera(data) {
    // 搜索相机

    const { originId, sceneType, sceneChangeType, id } = data;
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      await this.changeSystemCustom(sceneChangeType, originId, sceneType);
      this.currentSystem.setSearchCameraId(id); // 记录搜索相机信息
    }
    if (sceneChangeType === "noChange") {
      // 直接搜索
      this.currentSystem.searchCamera(id);
    }
  }

  async searchInspectionSystem(data) {
    // 搜索相机

    const { originId, sceneType, sceneChangeType, id } = data;
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      await this.changeSystemCustom(sceneChangeType, originId, sceneType);
      this.currentSystem.setSearchInspectionSystemId(id); // 记录搜索相机信息
    }
    if (sceneChangeType === "noChange") {
      // 直接搜索
      this.currentSystem.searchInspectionSystem(id);
    }
  }

  async search(data) {
    this.clearSearch(); // 清除现有搜索数据

    if (!data) return;

    const {
      type,
      sceneType,
      originId,
      id,
      filter,
      sceneChangeType,
      inDoorModel,
    } = data;
    if (!inDoorModel) {
      // 搜索人/设备在未建模的建筑里面
      this.searchBuilding(originId, false);
      this.setIndoorModel(true);
      return false;
    }

    if (type === "person") return await this.searchPerson(data);

    if (type === "building") return this.searchBuilding(id);

    if (type === "equip") return await this.searchCamera(data);

    if (type === "inspection") return await this.searchInspection(data);

    if (type === "personDanger") return await this.personAlarmInit(data);

    if (type === "inspectionSystem")
      return await this.searchInspectionSystem(data);
  }

  async searchInspection(data) {
    // 搜索巡检

    const { originId, sceneType, sceneChangeType, id, name, position } = data;
    this.currentSystem.setSearchInspection({ id, name, position }); // 记录搜索信息
    if (sceneChangeType !== "noChange") {
      // 做了场景切换
      await this.changeSystemCustom(sceneChangeType, originId, sceneType);
      this.crossSearch.setCrossSearchInspectionStatus(true); // 记录跨场景的搜索
    }
    if (sceneChangeType === "noChange") {
      // 直接搜索
      this.currentSystem.searchInspection();
    }
  }

  processingEquipment(data, type) {
    // 设备系统
    this.currentSystem.processingEquipData(data, type);
  }

  changeLighting(param) {
    this.currentSystem.updateLightingPattern(param);
  }

  setCameraState(param) {
    this.currentSystem.setCameraState(param);
  }

  beginWander() {
    this.currentSystem.beginWander();
  }

  resetCamera() {
    this.currentSystem.resetCamera();
  }

  endWander() {
    this.currentSystem.endWander();
  }

  getMouse = (event, vector) => {
    const { left, top, width, height } =
      this.domElement.getBoundingClientRect();
    vector.x = ((event.clientX - left) / width) * 2 - 1;
    vector.y = -((event.clientY - top) / height) * 2 + 1;
  };

  // 定制化鼠标右键双击
  rightDblClickListener(fn) {
    const rightDblClick = this.addEventListener("mouseup");
    const del = rightDblClick.add((e) => {
      if (e.button !== 2) {
        return;
      }
      let timeStamp = new Date().getTime();
      if (timeStamp - rightMouseupTime < 250) {
        timeStamp = 0;
        fn(e);
      }
      rightMouseupTime = timeStamp;
    });
    return del;
  }

  /** 与楼层切换等操作同步，避免两套右键双击状态不一致 */
  resetRightDblClickState() {
    rightMouseupTime = 0;
  }

  // 定制化鼠标左键click 鼠标移动时不触发 右键不触发 连续点击时不触发
  addClickCustom(fn) {
    let timer = null;
    const down = this.addEventListener("mousedown");
    const downCancel = down.add((e) => {
      if (e.button === 2) return;
      this.getMouse(e, mousedown);
    });
    const up = this.addEventListener("mouseup");
    let ray;
    const upCancel = up.add((e) => {
      if (e.button === 2) return; // 右键不触发
      this.getMouse(e, mouseup);
      if (!mousedown.equals(mouseup)) return; //鼠标down和up位置不重合不触发
      if (timer) {
        //连续点击时不触发
        clearTimeout(timer);
        timer = null;
      } else {
        timer = setTimeout(() => {
          ray = new THREE.Raycaster();
          ray.setFromCamera(mouseup, this.camera);
          fn(ray);
          clearTimeout(timer);
          timer = null;
        }, 250);
      }
    });
    const clear = () => {
      downCancel();
      upCancel();
      ray = null;
    };
    return clear;
  }
}
