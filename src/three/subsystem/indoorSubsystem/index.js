import * as THREE from "three";
import * as TWEEN from "three/examples/jsm/libs/tween.module";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CustomSystem } from "../customSystem";
import { loadGLTF } from "@/three/loader";
import { getBoxCenter } from "../../../lib/box3Fun";
import { lightIndexUpdate, lightIndexReset } from "../../../shader/funs";
import { createCSS2DObject } from "../../../lib/CSSObject";

import { changeIndoor, web3dSelectCode } from "../../../message/postMessage";
import EquipmentPlate from "../../components/business/equipMentPlate";
import { SunnyTexture } from "../../components/weather";
import { SpecialGround } from "../../../lib/blMeshes";
import BoxModel from "../../../lib/boxModel";
import { dynamicFade, fadeByTime } from "../../../shader";
import { SceneHint } from "../../components/SceneHint";
import { equipmentTreeManager } from "./equipmentTreeManager";
import { smartLockOpenLogPage } from "../../../api/smartLock";

/**@type {OrbitControls} */
const controlsParameters = {
  maxPolarAngle: Math.PI / 2.05,
};

/** 室内整体亮度：灯光强度、渲染器曝光、PBR 环境反射（可按观感微调） */
const INDOOR_BRIGHTNESS = {
  rendererExposure: 1.12,
  ambient: 1.2,
  directional: 1.15,
  auxiliary: 0.38,
  spotlight: 1.0,
  envMapIntensity: 3.0,
  hdrBgExposure: 1.55,
  hdrEnvIntensity: 1.15,
  fallbackHdrBgExposure: 1.85,
  fallbackHdrEnvIntensity: 1.05,
  defaultSkyEnvIntensity: 0.85,
  glassEnvMapIntensity: 1.25,
};

/**@classdesc 定位子系统，包含场景，子系统特有的功能，用于主系统和子系统的切换（包含主场景和子场景切换） */
export class IndoorSubsystem extends CustomSystem {
  constructor(core) {
    super(core);
    this.gatherOrSilentData = {};
    this.gatherOrSilentLabel = null; // 预警牌子

    // 为子系统的子场景添加独一无二的灯光，背景图
    this.scene.background = SunnyTexture;
    this.onRenderQueue = core.onRenderQueue;
    this.controls = core.controls;

    this.camera = core.camera;
    this.tweenControl = core.tweenControl;
    this.orientation = core.orientation;

    this.buildingObject = {}; // 储存每一层楼的group
    this.currentFloor = null; // 当前楼层
    this.eventClear = [];

    // 初始化标签存储对象（按楼层存储）
    this.simpleLabel = {};

    // 建筑
    this.building = null;
    this.buildingName = null;

    this.endChangeFloor = true; // 楼层切换结束

    // 保存用于射线检测的楼层引用，定位
    this.floors = [];
    this.floorsName = [];

    // 设备标签数据存储（按楼层存储）
    this.deviceLabelsData = {};

    // 工艺设计数据存储（全局存储，按 code 索引）
    this.designDataMap = {};

    // 初始化场景提示
    this.sceneHint = new SceneHint();

    // 保存首次进入时的相机位置
    this.initialCameraPosition = null;
    this.initialControlsTarget = null;

    /** 当前选中的设备 CSS2D（门锁等） */
    this._selectedDeviceIconLabel = null;

    this._smartLockInfoCss2d = null;
    this._smartLockInfoReqSeq = 0;
  }

  async onEnter(buildingName) {
    // 注意：clearIndoorData 现在在 changeSystemCommon 中处理，避免重复清理

    this._prevToneMappingExposure = this.core.renderer.toneMappingExposure;
    this.core.renderer.toneMappingExposure = INDOOR_BRIGHTNESS.rendererExposure;

    if (this.core.ground && this.core.ground.hideAllBuildingLabel) {
      this.core.ground.hideAllBuildingLabel();
    }

    // 设置室内相机控制参数
    this.handleControls();

    this.currentPoint = null;
    EquipmentPlate.onLoad(this, this.core);

    if (!this.sceneHint) {
      this.sceneHint = new SceneHint();
    }

    this.sceneHint.show("右键双击返回室外");

    // 设置室内环境效果（默认使用 HDR）
    this.setIndoorEnvironment("room");

    // 按需加载设备树数据
    try {
      console.log(`开始按需加载建筑 ${buildingName} 的设备树数据...`);
      await equipmentTreeManager.getEquipmentTree(buildingName);
      console.log(`建筑 ${buildingName} 设备树数据加载完成`);
    } catch (error) {
      console.error(`加载建筑 ${buildingName} 设备树数据失败:`, error);
    }

    let obj = {
      name: buildingName,
      path: `./models/inDoor/${buildingName}.glb`,
      type: ".glb",
    };
    this.buildingName = buildingName;
    return await loadGLTF(
      [obj],
      this.onProgress.bind(this),
      this.onLoaded.bind(this)
    );
  }

  createGround(center, min) {
    // 获取建筑的包围盒
    let boundingBox = null;
    if (this.building) {
      boundingBox = new THREE.Box3().setFromObject(this.building);
    }

    const ground = new SpecialGround(center, min, boundingBox);

    // 设置地面接收阴影
    ground.receiveShadow = true;
    ground.castShadow = false; // 地面通常不投射阴影

    // 保存地面引用以便在渲染循环中更新
    this.ground = ground;

    // 设置地面材质的环境贴图
    if (this.scene.environment && ground.material) {
      this.setupIndoorMaterial(ground.material);
    }

    this.scene.add(ground);
  }

  /**
   * 创建BoxModel地面
   */
  createBoxModelGround(center, radius, min) {
    // 移除现有的BoxModel地面
    if (this.boxModelGround) {
      this.boxModelGround.dispose();
      this.boxModelGround = null;
    }

    // 创建新的BoxModel地面
    center.y = min.y - 0.5;
    this.boxModelGround = new BoxModel(this.core);
    this.boxModelGround.initModel(center, radius);
  }

  /**
   * 重新创建地面 - 根据当前模型重新计算地面范围
   */
  recreateGround() {
    // 移除现有地面
    if (this.ground) {
      this.scene.remove(this.ground);
      if (this.ground.geometry) {
        this.ground.geometry.dispose();
      }
      if (this.ground.material) {
        this.ground.material.dispose();
      }
      this.ground = null;
    }

    // 重新计算模型参数
    const param = getBoxCenter(this.building);

    // 创建新的地面 - 使用BoxModel
    this.createBoxModelGround(param.center, param.radius, param.min);

    console.log(
      "BoxModel地面已重新创建，新尺寸基于当前模型:",
      this.building.name
    );
  }

  handleControls() {
    Reflect.ownKeys(controlsParameters).forEach((key) => {
      this.controls.data = this.controls.data || {};
      this.controls.data[key] = this.controls[key];
      this.controls[key] = controlsParameters[key];
    });
  }

  resetControls() {
    Reflect.ownKeys(controlsParameters).forEach((key) => {
      if (this.controls.data && this.controls.data[key] !== undefined) {
        this.controls[key] = this.controls.data[key];
      }
    });
  }

  async onChangeSystemCustom(state, floorName, buildingName) {
    if (state === "outToIn") {
      await this.onEnter(buildingName);
      this.changeFloor(floorName);
    }
    if (state === "inToInSingle") {
      this.changeFloor(floorName);
    }
    if (state === "inToInOther") {
      this.clearIndoorData();
      await this.onEnter(buildingName);
      this.changeFloor(floorName);
    }
  }
  onProgress(gltf, name) {
    let all = gltf.scene.children;
    this.simpleInsert = {};
    all.forEach((child) => {
      this.simpleInsert[child.name] = [];
      child.children.forEach((ichild, index) => {
        if (ichild.name.includes("_shebei")) {
          this.simpleInsert[child.name].push(ichild);
          let labelName = ichild.name.split("_shebei")[0];
          const floorName = child.name; // 楼层名称
          
          // 初始化楼层标签对象
          if (!this.simpleLabel[floorName]) {
            this.simpleLabel[floorName] = {};
          }
          
          // 创建CSS2D标签
          const labelContainer = document.createElement("div");
          labelContainer.className = "qiehuan-label-container";
          labelContainer.style.cssText = `
                  background: linear-gradient(135deg, rgba(52, 152, 219, 0.1), rgba(41, 128, 185, 0.1));
                  color: white;
                  padding: 2px 4px;
                  border-radius: 8px;
                  font-size: 13px;
                  font-weight: 500;
                  // white-space: nowrap;
                  // pointer-events: none;
                  display: none;
                  // box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                  border: 1px solid rgba(255, 255, 255, 0.2);
                  // backdrop-filter: blur(8px);
                  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
                  letter-spacing: 0.5px;
                  position: relative;
                  overflow: hidden;
                `;

          // 添加发光效果
          labelContainer.innerHTML = `
                  <div style="
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
                    animation: shimmer 2s infinite;
                  "></div>
                  <span style="position: relative; z-index: 1;">${labelName}</span>
                `;

          // 添加CSS动画
          const style = document.createElement("style");
          style.textContent = `
                  @keyframes shimmer {
                    0% { left: -100%; }
                    100% { left: 100%; }
                  }
                `;
          document.head.appendChild(style);

          // 创建CSS2D对象
          const css2dObject = createCSS2DObject(
            labelContainer,
            `qiehuan-label-${labelName}`
          );

          // 计算ichild包围盒的中心顶部位置
          // center.y = max.y + 0.5; // 在顶部上方添加一点偏移

          // 获取ichild的世界坐标
          const worldPosition = new THREE.Vector3();
          ichild.getWorldPosition(worldPosition);
          css2dObject.position.copy(worldPosition);
          css2dObject.visible = false; // 默认隐藏
          css2dObject.center.set(0.5, 1);

          // 添加到场景
          this.scene.add(css2dObject);

          // 按楼层名称存储标签引用
          this.simpleLabel[floorName][labelName] = {
            element: labelContainer,
            css2dObject: css2dObject,
            deviceObject: ichild,
          };
        }
      });
    });

    const group = gltf.scene;
    this.building = group;
    group.children.forEach((child) => {
      const obj = { group: child, uTime: { value: 1.0 } };
      child.traverse((ichild) => {
        if (ichild.isMesh) {
          this.modelProcessing(ichild, obj);
          ichild.userData.parent = group.name;
        }
      });
      this.floors.push(child);
      this.floorsName.push(child.name);
      this.buildingObject[child.name] = obj;
    });
    this.scene.add(this.building);
  }
  modelProcessing(child, obj) {
    // 设置阴影属性
    child.castShadow = true;
    child.receiveShadow = true;

    if (child.material.transparent) {
      child.renderOrder = 3;
      child.material.depthWrite = true;
    }

    // 改进材质克隆逻辑，避免累积过多纹理
    const originalMaterial = child.material;
    child.material = originalMaterial.clone();

    // 确保新材质有正确的纹理引用
    const textureProperties = [
      "map",
      "normalMap",
      "emissiveMap",
      "specularMap",
      "roughnessMap",
      "metalnessMap",
      "alphaMap",
      "envMap",
      "lightMap",
      "aoMap",
      "displacementMap",
      "bumpMap",
    ];

    textureProperties.forEach((prop) => {
      if (originalMaterial[prop]) {
        child.material[prop] = originalMaterial[prop];
      }
    });

    child.material.transparent = true;
    child.material.metalness = 0.2;
    child.material.roughness = 0.8;

    this.setupIndoorMaterial(child.material);

    // 处理材质名称为 "bl" 的材质，添加环境贴图
    if (child.material.name === "bl" || child.material.name === "blad") {
      this.addIndoorGlassProperties(child.material);
    }

    if (
      !child.name.includes("BDW") &&
      child.material.name.includes("建筑外壳")
    ) {
      dynamicFade(child.material, obj.uTime, new THREE.Color("#3acacc"));

      child.renderOrder = 2;
    } else {
      fadeByTime(child.material, obj.uTime);
    }
  }

  onLoaded() {
    // 重新计算地面范围
    this.recreateGround();
    this.createAndSetupLights(this.building);

    if (this.scene.environment) {
      this.processIndoorEnvMapMaterials();
    }

    // 设置渲染队列，确保地面着色器能够更新
    if (this.core && this.core.onRenderQueue) {
      this.core.onRenderQueue.set("indoorSubsystem", this.update.bind(this));
    }

    console.log("=== 首次进入室内 - onLoaded ===");
    console.log("当前相机位置:", this.camera.position);
    console.log("当前controls.target:", this.controls.target);

    // 保存首次进入时的相机位置
    this.initialCameraPosition = this.camera.position.clone();
    this.initialControlsTarget = this.controls.target.clone();
    console.log("保存的初始相机位置:", this.initialCameraPosition);
    console.log("保存的初始controls.target:", this.initialControlsTarget);

    this.cameraMove(this.building);
    this.addEventListener();

    // 室外设备.glb 上的门锁等 CSS2D 需挂到室内 scene，否则当前渲染室内时标签不显示
    if (
      this.core.ground &&
      typeof this.core.ground.mountDeviceIconsToIndoorScene === "function"
    ) {
      this.core.ground.mountDeviceIconsToIndoorScene(this.scene);
    }
  }
  cameraMove(group, startPosition = null) {
    return new Promise((res, rej) => {
      let position, target;
      const { center, radius } = getBoxCenter(group);
      target = center.clone();

      // 直接使用center和radius计算位置，不依赖_distance
      const cameraDistance = radius * 2; // 相机距离为半径的2倍
      position = new THREE.Vector3(
        center.x,
        center.y + 8,
        center.z + cameraDistance * 1.2
      );

      this.tweenControl.changeTo({
        start: this.camera.position,
        end: position,
        duration: 1000,
        onComplete: () => {
          this.controls.enable = true;
          console.log("测试数据=== cameraMove 调试信息 ===");
          console.log("测试数据传入的group:", group);
          console.log("测试数据建筑中心:", center);
          console.log("测试数据建筑半径:", radius);
          console.log("测试数据相机距离:", cameraDistance);
          console.log("测试数据计算出的目标位置:", position);
          console.log("测试数据目标target:", target);
          res();
        },
        onStart: () => {
          this.controls.enable = false;
        },
      });

      this.tweenControl.changeTo({
        start: this.controls.target,
        end: target,
        duration: 1000,
        onUpdate: () => {
          this.controls.update();
        },
      });
    });
  }
  cameraMoveQiehuan(group, startPosition = null) {
    return new Promise((res, rej) => {
      let position, target;
      const { center, radius } = getBoxCenter(group);
      target = center.clone();

      // 直接使用center和radius计算位置，不依赖_distance
      const cameraDistance = radius * 2; // 相机距离为半径的2倍
      position = new THREE.Vector3(
        center.x,
        center.y + cameraDistance * 0.8,
        center.z + cameraDistance * 0.4
      );

      this.tweenControl.changeTo({
        start: this.camera.position,
        end: position,
        duration: 1000,
        onComplete: () => {
          this.controls.enable = true;
          console.log("测试数据=== cameraMove 调试信息 ===");
          console.log("测试数据传入的group:", group);
          console.log("测试数据建筑中心:", center);
          console.log("测试数据建筑半径:", radius);
          console.log("测试数据相机距离:", cameraDistance);
          console.log("测试数据计算出的目标位置:", position);
          console.log("测试数据目标target:", target);
          res();
        },
        onStart: () => {
          this.controls.enable = false;
        },
      });

      this.tweenControl.changeTo({
        start: this.controls.target,
        end: target,
        duration: 1000,
        onUpdate: () => {
          this.controls.update();
        },
      });
    });
  }

  cameraMoveToFloor(group) {
    return new Promise((res, rej) => {
      const { center, radius, min, max } = getBoxCenter(group);

      const floorHeight = max.y - min.y;
      const target = center.clone();

      const cameraDistance = Math.max(floorHeight * 1.5, radius * 1);
      const position = new THREE.Vector3(
        center.x,
        center.y + floorHeight + cameraDistance * 1.2,
        center.z + cameraDistance
      );

      this.tweenControl.changeTo({
        start: this.camera.position,
        end: position,
        duration: 1200,
        onComplete: () => {
          this.controls.enable = true;
          res();
        },
        onStart: () => {
          this.controls.enable = false;
        },
      });

      this.tweenControl.changeTo({
        start: this.controls.target,
        end: target,
        duration: 1200,
        onUpdate: () => {
          this.controls.update();
        },
      });
    });
  }

  onLeave() {
    if (this._prevToneMappingExposure !== undefined) {
      this.core.renderer.toneMappingExposure = this._prevToneMappingExposure;
      this._prevToneMappingExposure = undefined;
    }

    if (this.core.ground && this.core.ground.showAllBuildingLabel) {
      this.core.ground.showAllBuildingLabel();
    }
    this.syncGroundDeviceIconVisibility(null);
    this.clearDeviceIconSelection();
    this.resetControls();

    if (this.sceneHint) {
      this.sceneHint.hide();
    }

    // 清理渲染队列
    if (this.core && this.core.onRenderQueue) {
      this.core.onRenderQueue.delete("indoorSubsystem");
    }

    // 执行完整的清理操作
    this.clearIndoorData();

    console.log("室内系统 onLeave 完成");
  }
  addEventListener() {
    this.addRayDbClick();
    this.addRayMove();
    this.addRightDbClickQuit();
  }
  addRayDbClick() {
    let event = this.core.raycast("dblclick", this.floors, (intersects) => {
      if (intersects.length) {
        let target = intersects[0].object;
        while (!this.floors.includes(target)) {
          target = target.parent;
        }
        console.log(target.name, "target");
        this.changeFloor(target.name);
      }
    });
    this.eventClear.push(event.clear);
    return event.clear;
  }
  disposeGatherOrSilent() {
    let toDelete = [];
    for (let key in this.gatherOrSilentData) {
      toDelete.push(key);
    }
    toDelete.forEach((key) => {
      delete this.gatherOrSilentData[key];
    });
    this.gatherOrSilentData = {};
    this.disPoseGatherShader();
  }

  /**
   * 室外「设备.glb」上 CSS2D 图标的楼层键与室内 `changeFloor(floor)` 的 floor 一致时（均为楼层节点名，如 A01B001F03），
   * 仅显示当前楼层对应图标，其余隐藏。离开室内时可传 null 全部隐藏。
   * @param {string|null|undefined} floorKey
   */
  syncGroundDeviceIconVisibility(floorKey) {
    if (
      this.core.ground &&
      typeof this.core.ground.setDeviceIconVisibilityForFloor === "function"
    ) {
      this.core.ground.setDeviceIconVisibilityForFloor(floorKey);
    }
  }

  clearDeviceIconSelection() {
    this._smartLockInfoReqSeq += 1;
    const el = this._selectedDeviceIconLabel?.element;
    if (el) {
      el.classList.remove("web3d-device-icon--selected");
    }
    this._selectedDeviceIconLabel = null;

    if (this._smartLockInfoCss2d) {
      this._smartLockInfoCss2d.visible = false;
      if (this._smartLockInfoCss2d.element) {
        this._smartLockInfoCss2d.element.style.display = "none";
      }
    }
  }

  _buildSmartLockInfoBoardRoot(lock, uuid, openLogs, meta) {
    const loading = meta?.loading;
    const errMsg = meta?.error;
    const noQuery = meta?.noQuery;

    const root = document.createElement("div");
    root.className = "web3d-smartlock-board";

    const title = document.createElement("div");
    title.className = "web3d-smartlock-board__title";
    title.textContent = lock?.name || `门锁 ${uuid}`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "web3d-smartlock-board__close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.clearDeviceIconSelection();
    });
    title.appendChild(closeBtn);
    root.appendChild(title);

    const kv = document.createElement("div");
    kv.className = "web3d-smartlock-board__kv";

    const addKv = (k, v) => {
      const ke = document.createElement("div");
      ke.className = "web3d-smartlock-board__k";
      ke.textContent = k;
      const ve = document.createElement("div");
      ve.className = "web3d-smartlock-board__v";
      ve.textContent = v == null ? "-" : String(v);
      kv.appendChild(ke);
      kv.appendChild(ve);
    };

    addKv("apartmentName", lock?.apartmentName);
    addKv("floorName", lock?.floorName);
    addKv("roomName", lock?.roomName);
    addKv("uuid", lock?.uuid || uuid);
    addKv("status", lock?.status);
    addKv("battery", lock?.battery);
    addKv("firmware", lock?.firmwareVersion);

    root.appendChild(kv);

    const divider = document.createElement("div");
    divider.className = "web3d-smartlock-board__divider";
    root.appendChild(divider);

    const logsTitle = document.createElement("div");
    logsTitle.className = "web3d-smartlock-board__logs-title";
    if (noQuery) {
      logsTitle.textContent = "开门记录";
    } else {
      logsTitle.textContent = `开门记录（lockName: ${lock?.name || "-"}，apartmentName: ${
        lock?.apartmentName || "-"
      }）`;
    }
    root.appendChild(logsTitle);

    if (loading) {
      const t = document.createElement("div");
      t.className = "web3d-smartlock-board__log-meta";
      t.textContent = "开门记录加载中…";
      root.appendChild(t);
    } else if (errMsg) {
      const t = document.createElement("div");
      t.className = "web3d-smartlock-board__log-meta";
      t.textContent = `加载失败: ${errMsg}`;
      root.appendChild(t);
    } else if (noQuery) {
      const t = document.createElement("div");
      t.className = "web3d-smartlock-board__log-meta";
      t.textContent =
        "无接口1数据：无法从 uuid 关联 lockName / apartmentName，不请求开门记录。";
      root.appendChild(t);
    } else {
      const showLogs = (openLogs || []).slice(0, 12);
      if (!showLogs.length) {
        const empty = document.createElement("div");
        empty.className = "web3d-smartlock-board__log-meta";
        empty.textContent = "暂无记录";
        root.appendChild(empty);
      } else {
        showLogs.forEach((r) => {
          const row = document.createElement("div");
          row.className = "web3d-smartlock-board__log";
          const op = document.createElement("div");
          op.className = "web3d-smartlock-board__log-op";
          op.textContent = r.operation || "-";
          const metaE = document.createElement("div");
          metaE.className = "web3d-smartlock-board__log-meta";
          metaE.textContent = `${r.name || "-"} ${r.cardCode || "-"} · ${r.operTime || "-"}`;
          row.appendChild(op);
          row.appendChild(metaE);
          root.appendChild(row);
        });
      }
    }

    return root;
  }

  _attachSmartLockInfoBoardToLabel(root, label) {
    if (!this._smartLockInfoCss2d) {
      this._smartLockInfoCss2d = createCSS2DObject(root, "smartLockInfoBoard");
      this.scene.add(this._smartLockInfoCss2d);
    } else {
      const oldEl = this._smartLockInfoCss2d.element;
      if (oldEl && oldEl.parentElement) {
        oldEl.parentElement.replaceChild(root, oldEl);
      }
      this._smartLockInfoCss2d.element = root;
    }
    const wp = new THREE.Vector3();
    label.getWorldPosition(wp);
    wp.y += 3.0;
    this._smartLockInfoCss2d.position.copy(wp);
    this._smartLockInfoCss2d.visible = true;
    root.style.display = "block";
  }

  /**
   * 点击/搜索选中门锁后：调接口2，参数 lockName、apartmentName 来自接口1 中与 uuid 关联的 name、apartmentName
   */
  async showSmartLockInfoForLabel(label) {
    const uuid = label?.userData?.deviceIconDeviceId;
    if (!uuid) return;

    // 等接口1落地后再按 uuid 取 lock，避免点击比 init 快导致不调接口2
    try {
      if (this.core?.ground?.initSmartLockData) {
        await this.core.ground.initSmartLockData();
      }
    } catch (_) {
      // init 失败仍继续展示/尝试按 uuid
    }

    // clearDeviceIconSelection 与 focus 已 bump 过 seq，这里不要再 ++，否则 req 与回包校验会错位
    const req = this._smartLockInfoReqSeq;
    const lock = this.core?.ground?.getSmartLockInfoByUuid?.(uuid);

    const lockName = lock?.name;
    const apartmentName = lock?.apartmentName;

    this._attachSmartLockInfoBoardToLabel(
      this._buildSmartLockInfoBoardRoot(lock, uuid, null, { loading: true }),
      label
    );

    if (!lockName || !apartmentName) {
      this._attachSmartLockInfoBoardToLabel(
        this._buildSmartLockInfoBoardRoot(lock, uuid, [], { noQuery: true }),
        label
      );
      return;
    }

    try {
      const res = await smartLockOpenLogPage({
        pageNum: 1,
        pageSize: 12,
        lockName,
        apartmentName,
      });
      if (req !== this._smartLockInfoReqSeq) return;
      const logs = res?.result?.data?.list || [];
      this._attachSmartLockInfoBoardToLabel(
        this._buildSmartLockInfoBoardRoot(lock, uuid, logs, { loading: false }),
        label
      );
    } catch (e) {
      if (req !== this._smartLockInfoReqSeq) return;
      this._attachSmartLockInfoBoardToLabel(
        this._buildSmartLockInfoBoardRoot(lock, uuid, [], {
          loading: false,
          error: e?.message || String(e),
        }),
        label
      );
    }
  }

  /**
   * 视角拉近到设备 CSS2D 标签，并加上选中样式（依赖当前已在目标楼层且标签已挂到室内 scene）。
   * @param {import("three/examples/jsm/renderers/CSS2DRenderer").CSS2DObject} label
   */
  focusDeviceIconLabel(label) {
    this.clearDeviceIconSelection();
    if (!label || !label.element) return;

    this._selectedDeviceIconLabel = label;
    label.element.classList.add("web3d-device-icon--selected");
    label.visible = true;
    void this.showSmartLockInfoForLabel(label);

    if (this.currentFloor?.name) {
      this.syncGroundDeviceIconVisibility(this.currentFloor.name);
    }

    const wp = new THREE.Vector3();
    label.getWorldPosition(wp);

    let radius = 40;
    if (this.currentFloor) {
      const box = new THREE.Box3().setFromObject(this.currentFloor);
      const size = box.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.z, 20) * 0.5;
    }
    const dist = Math.max(radius * 0.9, 14);
    const endPos = new THREE.Vector3(
      wp.x + dist * 0.55,
      wp.y + dist * 0.42,
      wp.z + dist * 0.55
    );

    this.tweenControl.changeTo({
      start: this.camera.position,
      end: endPos,
      duration: 1100,
      onComplete: () => {
        this.controls.enable = true;
      },
      onStart: () => {
        this.controls.enable = false;
      },
    });
    this.tweenControl.changeTo({
      start: this.controls.target,
      end: wp,
      duration: 1100,
      onUpdate: () => {
        this.controls.update();
      },
    });
  }

  changeFloor(floor) {
    return new Promise((resolve, reject) => {
      if (!this.buildingObject || !this.buildingObject[floor]) {
        console.warn(`楼层 "${floor}" 的建筑数据尚未加载完成，请稍后再试`);
        reject(new Error(`楼层 "${floor}" 的建筑数据尚未加载完成`));
        return;
      }

      this.clearDeviceIconSelection();

      if (!this.endChangeFloor) {
        reject(new Error("楼层切换正在进行中"));
        return;
      }

      // 如果已经是目标楼层，直接返回成功
      if (
        this.currentFloor &&
        this.currentFloor.name === floor &&
        this.endChangeFloor
      ) {
        console.log(`已经在目标楼层 ${floor}，无需切换`);
        this.syncGroundDeviceIconVisibility(floor);
        resolve();
        return;
      }

      // 与 Core 共用一套右键双击间隔状态，切换楼层后双击可稳定回到整栋楼
      this.core.resetRightDblClickState();

      this.resetData();

      // 清理当前楼层的设备标签
      this.clearDeviceLabels();

      // 清理切换标签（牌子）
      this.hideAllQiehuanLabels();

      // 移除双击退出楼栋方法，避免与楼层内右键双击冲突
      this.removeEventListener();

      if (!this.currentFloor) {
        this.endChangeFloor = false;
        this.switchFloorAnimate(floor)
          .then((res) => {
            if (
              window.configs.floorToName[this.buildingName + "_室内"] &&
              window.configs.floorToName[this.buildingName + "_室内"][floor]
            ) {
              changeIndoor(
                window.configs.floorToName[this.buildingName + "_室内"][floor]
              );
            }
            super.updateOrientation();
            this.core.crossSearch.changeSceneSearch();
            this.endChangeFloor = true;
            this.gatherOrSilentShader();

            // 在楼层切换动画完成后加载设备标签数据
            this.loadAndRenderDeviceLabels();

            // 显示当前楼层的标签
            this.showFloorLabels(floor);

            // 室外设备模型：仅当前楼层 CSS2D 图标可见
            this.syncGroundDeviceIconVisibility(floor);

            // 从存储的数据中检索并应用设计数据
            this.applyStoredDesignData(floor);

            // 确保在楼层切换完成后重新注册右键双击事件
            this.setupFloorRaycastEvents(floor);
            this.sceneHint.updateMessage("右键双击恢复楼栋");

            // 楼层切换完成，解析Promise
            resolve();
          })
          .catch((error) => {
            this.endChangeFloor = true;
            reject(error);
          });
        this.buildingAnimate(floor);
      } else {
        // 如果已经有当前楼层，执行楼层内部切换
        this.floorSwitchInner(floor)
          .then(() => {
            // 与首次进入某层一致：重新注册「右键双击恢复楼栋」，并恢复聚集/静默着色与提示
            this.setupFloorRaycastEvents(floor);
            if (this.sceneHint) {
              this.sceneHint.updateMessage("右键双击恢复楼栋");
            }
            this.gatherOrSilentShader();
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      }
    });
  }
  gatherOrSilentShader() {
    this.disPoseGatherShader();
    if (this.gatherOrSilentData[this.currentFloor.name]) {
      const { id, type, areaType, areaDataOut, areaDataBuilding, areaName } =
        this.gatherOrSilentData[this.currentFloor.name];
      this.gatherOrSilentLabel =
        this.core.ground.gatherOrSilentPlate.gatherModel(
          this.currentFloor,
          type,
          areaName
        );
      this.scene.add(this.gatherOrSilentLabel);
    }
  }
  disPoseGatherShader() {
    if (this.gatherOrSilentLabel) {
      this.core.ground.gatherOrSilentPlate.clearGeometryGather(
        this.currentFloor
      );
      this.gatherOrSilentLabel.deleteSelf();
      this.gatherOrSilentLabel = null;
    }
  }
  addIndoorEvent() {
    let cancel = this.core.addClickCustom(this.indoorClickEvent.bind(this));
    this.eventClear.push(cancel);
  }
  indoorClickEvent(ray) {
    let personInserts = ray.intersectObject(
      this.orientation.orientation3D.singleGroup
    );
    const personInsertsVisible = personInserts.filter(
      (intersect) => intersect.object.visible
    );
    if (personInsertsVisible.length) {
      this.core.clearSearch();
      const object = personInsertsVisible[0].object;
      this.orientation.setSearchId(object.name);
      this.orientation.search();
      this.orientation.personSearchModule.setPosition();
      return;
    }
    let equipInserts = ray.intersectObject(EquipmentPlate.equipGroup);
    const equipInsertsVisible = equipInserts.filter(
      (intersect) => intersect.object.visible
    );
    if (equipInsertsVisible.length) {
      this.core.clearSearch();
      let typeName = equipInsertsVisible[0].object.typeName;
      let id = equipInsertsVisible[0].object.name;
      EquipmentPlate.searchEquip(id, typeName);
      return;
    }
  }
  addRayMove() {
    let event = this.core.raycast("mousemove", this.floors, (intersects) => {
      if (intersects.length) {
        let target = intersects[0].object;
        while (!this.floors.includes(target)) {
          target = target.parent;
        }
        console.log(target.name, "target");
        if (this.currentPoint === target) return;
        this.currentPoint = target;
        document.body.style.cursor = "pointer";
        this.core.postprocessing.clearOutlineAll(1);
        this.core.postprocessing.addOutline(target, 1);
      } else {
        if (!this.currentPoint) return;
        this.resetEffect();
      }
    });

    this.eventClear.push(event.clear);
    return event.clear;
  }
  setFloorGatherOrSilent(param) {
    this.gatherOrSilentData[param.areaDataFloor] = param;
  }
  addRightDbClickQuit() {
    const del = this.rightDblClickListener(() => {
      this.core.changeSystem("ground");
    });
    this.eventClear.push(del);
  }

  /** 取消跟随后与 addRightDbClickQuit 一致，恢复「右键双击回室外」 */
  addRightDbClickReset() {
    this.addRightDbClickQuit();
  }

  /** 与 Store3D.rightDblClickListener 一致（画布 mouseup、250ms），整栋楼与单层共用同一套检测 */
  rightDblClickListener(fn) {
    return this.core.rightDblClickListener(fn);
  }

  /**
   * 重置右键双击事件的时间戳
   */
  resetRightClickTimestamps() {
    this.core.resetRightDblClickState();
  }
  switchFloorAnimate(target) {
    if (
      !this.buildingObject ||
      !this.buildingObject[target] ||
      !this.buildingObject[target].group
    ) {
      console.error(`楼层 "${target}" 的建筑数据不完整，无法执行楼层切换动画`);
      return Promise.reject(new Error(`楼层 "${target}" 的建筑数据不完整`));
    }

    const group = this.buildingObject[target].group;

    const { min, max } = getBoxCenter(group);
    return new Promise((res, rej) => {
      lightIndexUpdate(max.y, min.y);

      this.currentFloor = group;
      this.cameraMoveToFloor(group).then(() => {
        res({ sceneType: 0, originId: target });
      });
    });
  }
  // 楼层内部之间切换
  floorSwitchInner(target) {
    return new Promise((resolve, reject) => {
      if (
        !this.buildingObject ||
        !this.buildingObject[target] ||
        !this.buildingObject[target].group
      ) {
        console.error(
          `楼层 "${target}" 的建筑数据不完整，无法执行楼层内部切换`
        );
        reject(new Error(`楼层 "${target}" 的建筑数据不完整`));
        return;
      }

      this.endChangeFloor = false;
      const group = this.buildingObject[target].group;
      const { min, max } = getBoxCenter(group);
      lightIndexReset();
      lightIndexUpdate(max.y, min.y);

      // 清理切换标签（牌子）
      this.hideAllQiehuanLabels();

      let lastFloor = this.currentFloor.name;
      this.buildingObject[lastFloor].uTime.value = 0.2;
      this.buildingObject[target].group.visible = true;
      this.buildingObject[target].uTime.value = 1;

      new TWEEN.Tween(this.buildingObject[lastFloor].uTime)
        .to({ value: 0.0 }, 1000)
        .start()
        .onComplete(() => {
          this.buildingObject[lastFloor].group.visible = false;
        });

      this.currentFloor = group;
      this.cameraMoveToFloor(group)
        .then(() => {
          super.updateOrientation();
          this.core.crossSearch.changeSceneSearch();
          this.endChangeFloor = true;

          // 在楼层内部切换完成后加载设备标签数据
          this.loadAndRenderDeviceLabels();

          // 显示当前楼层的标签
          this.showFloorLabels(target);

          // 室外设备模型：仅当前楼层 CSS2D 图标可见
          this.syncGroundDeviceIconVisibility(target);

          // 从存储的数据中检索并应用设计数据
          this.applyStoredDesignData(target);

          // 楼层内部切换完成，解析Promise
          resolve();
        })
        .catch((error) => {
          this.endChangeFloor = true;
          reject(error);
        });
    });
  }
  resetEffect() {
    this.currentPoint = null;
    document.body.style.cursor = "auto";
    this.core.postprocessing.clearOutlineAll(1);
  }
  buildingAnimate(target) {
    return new Promise((res, rej) => {
      Reflect.ownKeys(this.buildingObject).forEach((key) => {
        if (key === target) {
        } else {
          const t = new TWEEN.Tween(this.buildingObject[key].uTime)
            .to({ value: 0.0 }, 1000)
            .start()
            .onComplete(() => {
              this.buildingObject[key].group.visible = false;
              res();
            });
        }
      });
    });
  }
  resetBuilding() {
    this.clearDeviceIconSelection();
    // 退出单层视角回到整栋楼：隐藏挂到室内场景的设备 CSS2D（门锁等）
    this.syncGroundDeviceIconVisibility(null);

    lightIndexUpdate();
    Reflect.ownKeys(this.buildingObject).forEach((key) => {
      this.buildingObject[key].group.visible = true;
      const t = new TWEEN.Tween(this.buildingObject[key].uTime)
        .to({ value: 1 }, 1000)
        .start()
        .onComplete(() => {
          this.currentFloor = null;
          this.resetData();
        });
    });
    if (this.sceneHint) {
      this.sceneHint.updateMessage("右键双击返回室外");
    }
  }
  resetData() {
    this.orientation.orientation3D.disposeClusterGroup();
    EquipmentPlate.disposeAll();
  }

  removeEventListener() {
    this.clearFloorRaycastEvents();
    this.eventClear.forEach((clear) => clear());
    this.eventClear = [];
    this.resetEffect();
  }
  dispose() {
    console.log("开始 dispose 室内系统...");

    this.currentFloor = null;

    // 彻底清理建筑对象和材质
    if (this.buildingObject) {
      Object.values(this.buildingObject).forEach((obj) => {
        if (obj.group) {
          // 遍历所有网格并清理材质
          obj.group.traverse((child) => {
            if (child.isMesh && child.material) {
              // 清理材质
              if (Array.isArray(child.material)) {
                child.material.forEach((material) => {
                  this.disposeMaterial(material);
                });
              } else {
                this.disposeMaterial(material);
              }
              child.material = null;
            }
            // 清理几何体
            if (child.geometry) {
              child.geometry.dispose();
            }
          });
          // 从场景中移除
          this.scene.remove(obj.group);
        }
      });
      this.buildingObject = {};
    }

    this.removeEventListener();
    this.resetData();
    this.scene.dispose();
    lightIndexUpdate();

    // 清理设备牌子
    this.clearDeviceLabelsAndInstance();

    // 清理切换标签
    this.clearQiehuanLabels();

    // 清理工艺设计数据存储
    this.designDataMap = {};

    // 清理BoxModel地面
    if (this.boxModelGround) {
      this.boxModelGround.dispose();
      this.boxModelGround = null;
    }

    if (this.sceneHint) {
      this.sceneHint.destroy();
      this.sceneHint = null;
    }

    this.removeLightHelpers();

    // 强制垃圾回收提示
    if (window.gc) {
      window.gc();
    }

    // 监控WebGL资源使用情况
    if (this.core && this.core.logWebGLResources) {
      console.log("dispose后的WebGL资源使用情况:");
      this.core.logWebGLResources();
    }

    // 清理纹理管理器
    if (this.core && this.core.textureManager) {
      this.core.textureManager.clearAll();
    }

    console.log("室内系统 dispose 完成");
  }

  /**
   * 添加灯光辅助器（用于调试）
   */
  addLightHelpers() {
    this.removeLightHelpers();

    this.mainLightHelper = new THREE.DirectionalLightHelper(
      this.lights.main,
      5
    );
    this.scene.add(this.mainLightHelper);

    this.auxiliaryLightHelper = new THREE.DirectionalLightHelper(
      this.lights.auxiliary,
      3
    );
    this.scene.add(this.auxiliaryLightHelper);

    this.shadowCameraHelper = new THREE.CameraHelper(
      this.lights.main.shadow.camera
    );
    this.scene.add(this.shadowCameraHelper);

    // 添加探照灯辅助器
    if (this.lights.spotlight) {
      this.spotlightHelper = new THREE.SpotLightHelper(this.lights.spotlight);
      this.scene.add(this.spotlightHelper);
    }
  }

  /**
   * 移除灯光辅助器
   */
  removeLightHelpers() {
    if (this.mainLightHelper) {
      this.scene.remove(this.mainLightHelper);
      this.mainLightHelper.dispose();
      this.mainLightHelper = null;
    }

    if (this.auxiliaryLightHelper) {
      this.scene.remove(this.auxiliaryLightHelper);
      this.auxiliaryLightHelper.dispose();
      this.auxiliaryLightHelper = null;
    }

    if (this.shadowCameraHelper) {
      this.scene.remove(this.shadowCameraHelper);
      this.shadowCameraHelper.dispose();
      this.shadowCameraHelper = null;
    }

    if (this.spotlightHelper) {
      this.scene.remove(this.spotlightHelper);
      this.spotlightHelper.dispose();
      this.spotlightHelper = null;
    }
  }

  /**
   * 设置室内环境效果
   * @param {string} type - 环境类型: 'room', 'hdr', 'default'
   */
  setIndoorEnvironment(type = "hdr") {
    // 先清理现有环境
    this.clearIndoorHDR();

    switch (type) {
      case "room":
        // 使用 RoomEnvironment
        const roomEnvironment = new RoomEnvironment(this.renderer);
        this.scene.environment = roomEnvironment.environment;
        this.scene.background = roomEnvironment.environment;
        console.log("室内已设置 RoomEnvironment");
        break;

      case "hdr":
        // 使用 HDR 环境贴图
        this.setIndoorHDRSky();
        break;

      case "default":
        // 使用默认环境
        this.scene.background = SunnyTexture;
        console.log("室内已设置默认环境");
        break;

      default:
        console.warn(`未知的室内环境类型: ${type}`);
        break;
    }

    // 更新所有材质的环境贴图
    this.processIndoorEnvMapMaterials();
  }

  /**
   * 设置室内金色HDR环境贴图和天空
   */
  setIndoorHDRSky() {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);

    loader.load(
      "./bg.hdr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.exposure = INDOOR_BRIGHTNESS.hdrBgExposure;

        this.scene.background = texture;

        const envTexture = texture.clone();
        envTexture.intensity = INDOOR_BRIGHTNESS.hdrEnvIntensity;
        this.scene.environment = envTexture;

        this.processIndoorEnvMapMaterials();
      },

      (error) => {
        console.error("室内HDR加载失败:", error);
        this.setFallbackIndoorHDR();
      }
    );
  }

  /**
   * 备用HDR方案
   */
  setFallbackIndoorHDR() {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);

    loader.load(
      "./bg.hdr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.exposure = INDOOR_BRIGHTNESS.fallbackHdrBgExposure;

        this.scene.background = texture;

        const envTexture = texture.clone();
        envTexture.intensity = INDOOR_BRIGHTNESS.fallbackHdrEnvIntensity;
        this.scene.environment = envTexture;

        this.processIndoorEnvMapMaterials();
      },

      (error) => {
        console.error("备用HDR也加载失败:", error);
        this.setDefaultIndoorSky();
      }
    );
  }

  /**
   * 默认室内天空方案
   */
  setDefaultIndoorSky() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#FFD700");
    gradient.addColorStop(0.3, "#FFA500");
    gradient.addColorStop(0.7, "#FF8C00");
    gradient.addColorStop(1, "#FF4500");

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    this.scene.background = texture;

    const envTexture = texture.clone();
    envTexture.intensity = INDOOR_BRIGHTNESS.defaultSkyEnvIntensity;
    this.scene.environment = envTexture;
  }

  /**
   * 处理室内环境贴图材质
   */
  processIndoorEnvMapMaterials() {
    this.scene.traverse((object) => {
      if (object.isMesh && object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => {
            this.setupIndoorMaterial(material);
          });
        } else {
          this.setupIndoorMaterial(object.material);
        }
      }
    });
  }

  /**
   * 设置室内材质的环境贴图
   */
  setupIndoorMaterial(material) {
    if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
      if (this.scene.environment) {
        material.envMap = this.scene.environment;
        material.envMapIntensity = INDOOR_BRIGHTNESS.envMapIntensity;
      } else {
        material.envMapIntensity = 0;
      }
      material.needsUpdate = true;
    }
  }

  /**
   * 为室内材质名称为 "bl" 的材质添加玻璃属性，实现反光玻璃效果
   * @param {THREE.Material} material 原始材质
   */
  addIndoorGlassProperties(material) {
    // 加载 sIBL-LA_Downtown_Afternoon_Fishing_3k.hdr 环境贴图
    const rgbeLoader = new RGBELoader();
    rgbeLoader.setDataType(THREE.FloatType);

    rgbeLoader.load(
      "./Dutch-Sky_0168_4k.hdr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        // 为材质设置环境贴图
        material.envMap = texture;
        material.envMapIntensity = INDOOR_BRIGHTNESS.glassEnvMapIntensity;
        material.needsUpdate = true;

        console.log(
          "已为室内材质 bl 添加 sIBL-LA_Downtown_Afternoon_Fishing_3k.hdr 环境贴图"
        );
      },
      (progress) => {
        if (progress.lengthComputable) {
          console.log(
            "室内环境贴图加载进度:",
            (progress.loaded / progress.total) * 100 + "%"
          );
        }
      },
      (error) => {
        console.error("室内环境贴图加载失败:", error);
        // 如果加载失败，使用场景的环境贴图作为备用
        if (this.scene.environment) {
          material.envMap = this.scene.environment;
          material.envMapIntensity = INDOOR_BRIGHTNESS.glassEnvMapIntensity;
          material.needsUpdate = true;
          console.log("室内材质 bl 使用场景环境贴图作为备用");
        }
      }
    );
  }

  /**
   * 清理室内HDR环境贴图
   */
  clearIndoorHDR() {
    if (this.scene.background) {
      this.scene.background.dispose();
      this.scene.background = null;
    }

    if (this.scene.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }

    this.scene.traverse((object) => {
      if (object.isMesh && object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => {
            if (material.envMap) {
              material.envMap = null;
              material.envMapIntensity = 0;
              material.needsUpdate = true;
            }
          });
        } else {
          if (object.material.envMap) {
            object.material.envMap = null;
            object.material.envMapIntensity = 0;
            object.material.needsUpdate = true;
          }
        }
      }
    });
  }

  /**
   * 子系统执行在动画帧中函数
   */
  update() {
    // 更新地面着色器时间
    if (this.ground && this.ground.update) {
      this.ground.update(this.core);
    }

    // 更新BoxModel地面
    if (this.boxModelGround) {
      this.boxModelGround.update(this.core.elapsedTime);
    }
  }

  /**
   * 清理室内系统数据（用于室内切换时的清理）
   */
  clearIndoorData() {
    console.log("开始清理室内系统数据...");

    // 切换楼栋时，彻底清理门锁选中态与信息牌子，避免旧 CSS2DObject/DOM 悬空导致后续不显示
    this.clearDeviceIconSelection();
    if (this._smartLockInfoCss2d) {
      this.scene.remove(this._smartLockInfoCss2d);
      if (this._smartLockInfoCss2d.element) {
        this._smartLockInfoCss2d.element.remove();
      }
      this._smartLockInfoCss2d = null;
    }

    if (
      this.core.ground &&
      typeof this.core.ground.detachDeviceIconsFromIndoorScene === "function"
    ) {
      this.core.ground.detachDeviceIconsFromIndoorScene();
    }

    this.removeEventListener();
    this.resetData();
    this.disposeGatherOrSilent();

    // 清理设备牌子
    this.clearDeviceLabelsAndInstance();

    // 清理切换标签
    this.clearQiehuanLabels();

    if (this.sceneHint) {
      this.sceneHint.hide();
    }

    // 清理地面
    if (this.ground) {
      this.scene.remove(this.ground);
      if (this.ground.geometry) {
        this.ground.geometry.dispose();
      }
      if (this.ground.material) {
        this.ground.material.dispose();
      }
      this.ground = null;
    }

    // 清理BoxModel地面
    if (this.boxModelGround) {
      this.boxModelGround.dispose();
      this.boxModelGround = null;
    }

    // 彻底清理建筑对象和材质
    if (this.buildingObject) {
      Object.values(this.buildingObject).forEach((obj) => {
        if (obj.group) {
          // 遍历所有网格并清理材质
          obj.group.traverse((child) => {
            if (child.isMesh && child.material) {
              // 清理材质
              if (Array.isArray(child.material)) {
                child.material.forEach((material) => {
                  this.disposeMaterial(material);
                });
              } else {
                this.disposeMaterial(child.material);
              }
              child.material = null;
            }
            // 清理几何体
            if (child.geometry) {
              child.geometry.dispose();
            }
          });
          // 从场景中移除
          this.scene.remove(obj.group);
        }
      });
      this.buildingObject = {};
    }

    if (this.building && this.building.parent) {
      this.building.parent.remove(this.building);
      this.building = null;
    }

    this.buildingObject = {};
    this.floors = [];
    this.floorsName = [];
    this.currentFloor = null;
    this.endChangeFloor = true;

    // 清理工艺设计数据存储（可选：如果需要切换建筑时保留数据，可以注释掉这行）
    // this.designDataMap = {};

    this.resetControls();
    this.clearIndoorHDR();
    this.removeIndoorLights();

    // 强制垃圾回收提示
    if (window.gc) {
      window.gc();
    }

    // 监控WebGL资源使用情况
    if (this.core && this.core.logWebGLResources) {
      console.log("清理后的WebGL资源使用情况:");
      this.core.logWebGLResources();
    }

    // 清理纹理管理器
    if (this.core && this.core.textureManager) {
      this.core.textureManager.clearAll();
    }

    console.log("室内系统数据清理完成");
  }

  /**
   * 彻底清理材质及其纹理
   * @param {THREE.Material} material 要清理的材质
   */
  disposeMaterial(material) {
    if (!material) return;

    // 清理材质的所有纹理
    const textureProperties = [
      "map",
      "normalMap",
      "emissiveMap",
      "specularMap",
      "roughnessMap",
      "metalnessMap",
      "alphaMap",
      "envMap",
      "lightMap",
      "aoMap",
      "displacementMap",
      "bumpMap",
    ];

    textureProperties.forEach((prop) => {
      if (material[prop]) {
        // 使用纹理管理器清理纹理
        if (this.core && this.core.textureManager) {
          const textureKey = `${material.name || "unknown"}_${prop}`;
          this.core.textureManager.removeTexture(textureKey);
        } else {
          // 备用方案：直接清理
          material[prop].dispose();
        }
        material[prop] = null;
      }
    });

    // 清理材质本身
    material.dispose();
  }

  /**
   * 根据建筑包围盒创建和设置灯光
   * @param {THREE.Object3D} building - 建筑对象
   */
  createAndSetupLights(building) {
    if (!building) {
      console.warn("建筑对象未提供，无法创建和设置灯光");
      return;
    }

    // 先清理现有的灯光
    this.removeIndoorLights();

    const box = new THREE.Box3().setFromObject(building);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const min = box.min;
    const max = box.max;

    const buildingWidth = size.x;
    const buildingHeight = size.y;
    const buildingDepth = size.z;
    const maxDimension = Math.max(buildingWidth, buildingHeight, buildingDepth);

    // 创建环境光
    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      INDOOR_BRIGHTNESS.ambient
    );
    this.ambientLight = ambientLight;
    this._add(this.ambientLight);

    // 创建主方向光，位置设置在包围盒最高点上方
    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      INDOOR_BRIGHTNESS.directional
    );

    // 设置方向光位置在包围盒最高点上方
    const lightHeight = max.y + maxDimension * 0.5; // 在最高点上方一定距离
    directionalLight.position.set(center.x, lightHeight, center.z);

    // 设置方向光朝向建筑中心，但稍微向下以覆盖地面
    const targetPosition = center.clone();
    targetPosition.y = min.y - 50; // 目标点稍微低于地面，确保覆盖地面
    directionalLight.target.position.copy(targetPosition);

    // 配置方向光的阴影
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = lightHeight * 2;

    // 设置阴影相机视锥体以覆盖整个建筑和地面
    const shadowSize = maxDimension * 2; // 增大阴影覆盖范围
    directionalLight.shadow.camera.left = -shadowSize;
    directionalLight.shadow.camera.right = shadowSize;
    directionalLight.shadow.camera.top = shadowSize;
    directionalLight.shadow.camera.bottom = -shadowSize;

    // 设置阴影偏移和模糊
    directionalLight.shadow.bias = -0.0001;
    directionalLight.shadow.normalBias = 0.02;
    directionalLight.shadow.radius = 1.5;

    this.directionLight = directionalLight;
    this._add(this.directionLight);

    // 创建四周的辅助灯光
    const auxiliaryLights = [];

    // 计算四周灯光的位置
    const lightDistance = maxDimension * 1.5; // 灯光距离建筑的距离
    const lightHeight2 = center.y + buildingHeight * 0.7; // 灯光高度为建筑高度的70%

    // 四个方向的灯光位置
    const lightPositions = [
      // 前方（Z轴正方向）
      new THREE.Vector3(center.x, lightHeight2, center.z + lightDistance),
      // 后方（Z轴负方向）
      new THREE.Vector3(center.x, lightHeight2, center.z - lightDistance),
      // 左方（X轴负方向）
      new THREE.Vector3(center.x - lightDistance, lightHeight2, center.z),
      // 右方（X轴正方向）
      new THREE.Vector3(center.x + lightDistance, lightHeight2, center.z),
    ];

    // 创建四个方向的辅助灯光
    lightPositions.forEach((position, index) => {
      const auxiliaryLight = new THREE.DirectionalLight(
        0xffffff,
        INDOOR_BRIGHTNESS.auxiliary
      );
      auxiliaryLight.position.copy(position);

      // 设置灯光朝向建筑中心
      auxiliaryLight.target.position.copy(center);
      this._add(auxiliaryLight.target);

      // 配置阴影
      auxiliaryLight.castShadow = true;
      auxiliaryLight.shadow.mapSize.width = 1024;
      auxiliaryLight.shadow.mapSize.height = 1024;
      auxiliaryLight.shadow.camera.near = 0.1;
      auxiliaryLight.shadow.camera.far = lightDistance * 2;

      // 设置阴影相机视锥体
      const shadowSize2 = maxDimension * 1.5;
      auxiliaryLight.shadow.camera.left = -shadowSize2;
      auxiliaryLight.shadow.camera.right = shadowSize2;
      auxiliaryLight.shadow.camera.top = shadowSize2;
      auxiliaryLight.shadow.camera.bottom = -shadowSize2;

      // 设置阴影偏移和模糊
      auxiliaryLight.shadow.bias = -0.0001;
      auxiliaryLight.shadow.normalBias = 0.02;
      auxiliaryLight.shadow.radius = 1.0;

      auxiliaryLights.push(auxiliaryLight);
      this._add(auxiliaryLight);

      console.log(`创建辅助灯光 ${index + 1}，位置:`, position);
    });

    // 创建探照灯（建筑正面斜上方）
    const spotlight = new THREE.SpotLight(
      0xffffff,
      INDOOR_BRIGHTNESS.spotlight
    );

    // 设置探照灯位置在建筑正面斜上方
    const spotlightDistance = maxDimension * 1.2; // 探照灯距离建筑的距离
    const spotlightHeight = max.y + maxDimension * 0.8; // 探照灯高度
    const spotlightPosition = new THREE.Vector3(
      center.x, // X轴居中
      spotlightHeight, // Y轴在建筑上方
      center.z + spotlightDistance // Z轴在建筑前方
    );
    spotlight.position.copy(spotlightPosition);

    // 设置探照灯朝向建筑中心
    const spotlightTarget = center.clone();
    spotlightTarget.y = center.y + buildingHeight * 0.3; // 稍微向上一点，避免直射地面
    spotlight.target.position.copy(spotlightTarget);
    this._add(spotlight.target);

    // 配置探照灯参数
    spotlight.angle = Math.PI / 6; // 30度角
    spotlight.penumbra = 0.3; // 边缘柔和度
    spotlight.decay = 1.5; // 衰减
    spotlight.distance = spotlightDistance * 2; // 照射距离

    // 配置探照灯阴影
    spotlight.castShadow = true;
    spotlight.shadow.mapSize.width = 1024;
    spotlight.shadow.mapSize.height = 1024;
    spotlight.shadow.camera.near = 0.1;
    spotlight.shadow.camera.far = spotlightDistance * 2;
    spotlight.shadow.camera.fov = 30; // 视野角度
    spotlight.shadow.bias = -0.0001;
    spotlight.shadow.normalBias = 0.02;
    spotlight.shadow.radius = 1.0;

    this.spotlight = spotlight;
    this._add(this.spotlight);

    console.log("创建探照灯，位置:", spotlightPosition);

    // 将灯光存储到 lights 对象中，便于管理
    this.lights = {
      ambient: this.ambientLight,
      main: this.directionLight,
      auxiliary: auxiliaryLights,
      spotlight: this.spotlight, // 添加探照灯
    };

    console.log("室内灯光创建完成，包含主灯光、四周辅助灯光和探照灯");
  }

  /**
   * 移除室内灯光系统
   */
  removeIndoorLights() {
    this.removeLightHelpers();

    // 清理 this.lights 对象中的灯光
    if (this.lights) {
      if (this.lights.ambient) {
        this.scene.remove(this.lights.ambient);
        this.lights.ambient.dispose();
      }
      if (this.lights.main) {
        // 移除主方向光的目标点
        if (this.lights.main.target) {
          this.scene.remove(this.lights.main.target);
        }
        this.scene.remove(this.lights.main);
        this.lights.main.dispose();
      }
      if (this.lights.auxiliary && Array.isArray(this.lights.auxiliary)) {
        // 移除所有辅助灯光及其目标点
        this.lights.auxiliary.forEach((auxiliaryLight) => {
          if (auxiliaryLight.target) {
            this.scene.remove(auxiliaryLight.target);
          }
          this.scene.remove(auxiliaryLight);
          auxiliaryLight.dispose();
        });
      }
      if (this.lights.spotlight) {
        // 移除探照灯及其目标点
        if (this.lights.spotlight.target) {
          this.scene.remove(this.lights.spotlight.target);
        }
        this.scene.remove(this.lights.spotlight);
        this.lights.spotlight.dispose();
      }
      this.lights = null;
    }

    // 清理直接添加到场景中的灯光
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
      this.ambientLight.dispose();
      this.ambientLight = null;
    }

    if (this.directionLight) {
      // 移除方向光的目标点
      if (this.directionLight.target) {
        this.scene.remove(this.directionLight.target);
      }
      this.scene.remove(this.directionLight);
      this.directionLight.dispose();
      this.directionLight = null;
    }

    if (this.auxiliaryLight) {
      // 移除辅助光的目标点
      if (this.auxiliaryLight.target) {
        this.scene.remove(this.auxiliaryLight.target);
      }
      this.scene.remove(this.auxiliaryLight);
      this.auxiliaryLight.dispose();
      this.auxiliaryLight = null;
    }

    if (this.spotlight) {
      // 移除探照灯的目标点
      if (this.spotlight.target) {
        this.scene.remove(this.spotlight.target);
      }
      this.scene.remove(this.spotlight);
      this.spotlight.dispose();
      this.spotlight = null;
    }

    // 清理场景中所有剩余的灯光
    const lightsToRemove = [];
    this.scene.traverse((object) => {
      if (object.isLight) {
        lightsToRemove.push(object);
      }
    });

    lightsToRemove.forEach((light) => {
      console.log("清理场景中的灯光:", light.type, light.name || "unnamed");
      this.scene.remove(light);
      if (light.dispose) {
        light.dispose();
      }
    });

    console.log("室内灯光清理完成");
  }

  // 新增：清理楼层射线检测事件
  clearFloorRaycastEvents() {
    if (this._indoorRaycastClearFns) {
      console.log(
        `清理楼层射线检测事件，共 ${this._indoorRaycastClearFns.length} 个事件`
      );
      this._indoorRaycastClearFns.forEach((fn) => fn());
      this._indoorRaycastClearFns = [];
    }
  }

  // 新增：注册楼层children射线检测与outline事件
  setupFloorRaycastEvents(floor) {
    console.log(`开始设置楼层 ${floor} 的射线检测事件`);
    this.clearFloorRaycastEvents();
    const children = this.simpleInsert[floor] || [];
    this._indoorRaycastClearFns = [];

    if (children.length === 0) {
      console.warn(
        `楼层 ${floor} 没有子对象，仍注册右键双击恢复整栋楼（无设备材质可还原）`
      );
    }

    console.log(`楼层 ${floor} 有 ${children.length} 个子对象`);

    // 初始化时保存原始材质
    children.forEach((obj) => {
      obj.typeName = "device";
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          // 保存原始材质到对象本身
          if (!child._originalMaterial) {
            child._originalMaterial = child.material.clone();
          }
        }
      });
    });
    // 鼠标移动高亮
    // const moveEvt = this.core.raycast("mousemove", children, (intersects) => {
    //   if (intersects.length) {
    //     this.core.postprocessing.clearOutlineAll(1);
    //     this.core.postprocessing.addOutline(intersects[0].object, 1);
    //   } else {
    //     this.core.postprocessing.clearOutlineAll(1);
    //   }
    // });
    // this._indoorRaycastClearFns.push(moveEvt.clear);

    // 点击切换视角和蓝色轮廓
    // const clickEvt = this.core.raycast("click", children, (intersects) => {
    //   if (intersects.length) {
    //     let targetObj = intersects[0].object;
    //     if (!targetObj) return;

    //     // 调用设备点击处理方法
    //     const deviceCode = targetObj.name.split("_")[0];
    //     this.handleDeviceClick(deviceCode).catch((error) => {
    //       console.error("处理设备点击时发生错误:", error);
    //     });
    //   }
    // });
    // this._indoorRaycastClearFns.push(clickEvt.clear);

    // 右键双击恢复 - 调用楼栋级别的恢复功能
    console.log(`为楼层 ${floor} 注册右键双击恢复事件`);

    // 使用公用的rightDblClickListener方法
    const rightEvt = this.rightDblClickListener(() => {
      console.log(`楼层 ${floor} 的右键双击恢复事件被触发`);
      console.log("=== 右键双击恢复 - 开始 ===");
      console.log("当前相机位置:", this.camera.position);
      console.log("当前controls.target:", this.controls.target);

      // 隐藏所有切换标签（牌子）
      this.hideAllQiehuanLabels();

      // 先清除设备级别的效果
      this.core.postprocessing.clearOutlineAll(1);
      this.core.postprocessing.clearOutlineAll(2);
      // 恢复全部显示和原始材质
      children.forEach((obj) => {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            // 恢复原始材质
            if (child._originalMaterial) {
              child.material = child._originalMaterial;
            } else {
              // 如果没有保存原始材质，则重置为默认状态
              child.material.wireframe = false;
              child.material.transparent = false;
            }
            child.visible = true;
          }
        });
      });

      // 然后执行楼栋级别的恢复（重置到楼栋视角，显示所有楼层）
      this.removeEventListener();

      // 使用保存的初始相机位置来确保与首次进入时的视角一致
      this.cameraMove(this.building, this.initialCameraPosition);
      this.addEventListener();
      this.resetBuilding();
      this.disPoseGatherShader();

      // 重新绑定双击退出楼栋方法
      this.addRightDbClickQuit();
    });
    this._indoorRaycastClearFns.push(rightEvt);
    console.log(
      `楼层 ${floor} 的射线检测事件设置完成，共 ${this._indoorRaycastClearFns.length} 个事件`
    );
  }

  /**
   * 重置室内视角
   */
  resetCamera() {
    console.log("重置室内视角...");

    // 清除轮廓
    this.core.postprocessing.clearOutlineAll(1);
    this.core.postprocessing.clearOutlineAll(2);

    // 如果有当前楼层，恢复该楼层所有设备的显示和原始材质
    if (this.currentFloor && this.buildingObject[this.currentFloor.name]) {
      const children =
        this.buildingObject[this.currentFloor.name].group.children;

      // 恢复全部显示和原始材质
      children.forEach((obj) => {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            // 恢复原始材质
            if (child._originalMaterial) {
              child.material = child._originalMaterial;
            } else {
              // 如果没有保存原始材质，则重置为默认状态
              child.material.wireframe = false;
              child.material.transparent = false;
            }
            child.visible = true;
          }
        });
      });

      // 视角复位到切换楼层时的位置
      this.cameraMoveToFloor(
        this.buildingObject[this.currentFloor.name].group
      ).then(() => {
        console.log("室内视角重置完成");
      });
    } else {
      // 如果没有当前楼层，执行默认的相机移动
      if (this.building) {
        this.cameraMove(this.building).then(() => {
          console.log("室内视角重置完成（默认位置）");
        });
      }
    }
  }

  /**
   * 保存设备标签数据到实例变量
   * @param {Array} deviceData - 设备数据数组
   */
  saveDeviceLabelsToInstance(deviceData) {
    if (!Array.isArray(deviceData)) {
      console.warn("设备数据格式错误，应为数组");
      return;
    }

    console.log("保存设备标签数据...");
    console.log("要保存的数据:", deviceData);

    // 按设备编号存储数据
    deviceData.forEach((device) => {
      const { code } = device;
      if (code) {
        this.deviceLabelsData[code] = device;
        console.log(`设备标签数据已保存到实例: ${code}`, device);
      } else {
        console.warn("设备数据缺少code字段:", device);
      }
    });

    console.log("当前所有存储的数据:", this.deviceLabelsData);
  }

  /**
   * 从实例变量读取设备标签数据
   * @returns {Array|null} 设备数据数组或null
   */
  loadDeviceLabelsFromInstance() {
    if (!this.currentFloor || !this.buildingObject[this.currentFloor.name]) {
      console.log("当前楼层或建筑数据不存在");
      return null;
    }

    const children = this.buildingObject[this.currentFloor.name].group.children;
    const availableDevices = [];
    const deviceData = [];

    // 遍历当前楼层的所有设备
    children.forEach((child) => {
      const deviceCode = child.name.split("_")[0];
      if (deviceCode && this.deviceLabelsData[deviceCode]) {
        availableDevices.push(deviceCode);
        deviceData.push(this.deviceLabelsData[deviceCode]);
      }
    });

    if (deviceData.length > 0) {
      console.log(
        `从实例读取设备标签数据，找到 ${deviceData.length} 个设备:`,
        availableDevices
      );
      console.log("设备数据:", deviceData);
      return deviceData;
    }

    console.log("当前楼层没有找到对应的设备标签数据");
    return null;
  }

  /**
   * 清除实例中的设备标签数据
   * @param {Array} deviceCodes - 要清除的设备编号数组，如果不传则清除所有数据
   */
  clearDeviceLabelsFromInstance(deviceCodes = null) {
    if (deviceCodes && Array.isArray(deviceCodes)) {
      // 清除指定的设备数据
      deviceCodes.forEach((code) => {
        if (this.deviceLabelsData[code]) {
          delete this.deviceLabelsData[code];
          console.log(`已清除设备标签数据: ${code}`);
        }
      });
    } else {
      // 清除所有数据
      this.deviceLabelsData = {};
      console.log("已清除所有设备标签数据");
    }
  }

  /**
   * 清除所有楼层的设备标签数据
   */
  clearAllDeviceLabelsData() {
    this.deviceLabelsData = {};
    console.log("已清除所有楼层的设备标签数据");
  }

  /**
   * 加载并渲染实例中的设备标签
   */
  loadAndRenderDeviceLabels() {
    // 等待一帧确保设备对象已加载完成
    requestAnimationFrame(() => {
      console.log("开始加载设备标签数据...");
      console.log(
        "当前楼层:",
        this.currentFloor ? this.currentFloor.name : "null"
      );
      console.log("存储的数据:", this.deviceLabelsData);

      const deviceData = this.loadDeviceLabelsFromInstance();
      if (deviceData && deviceData.length > 0) {
        console.log("自动加载实例中的设备标签数据");
        this.updateDeviceLabels(deviceData);
      } else {
        console.log("没有找到当前楼层的设备标签数据");
      }
    });
  }

  /**
   * 更新设备标签
   * @param {Array} deviceData - 设备数据数组
   */
  updateDeviceLabels(deviceData) {
    if (!Array.isArray(deviceData)) {
      console.warn("设备数据格式错误，应为数组");
      return;
    }

    console.log("开始更新设备标签...");
    console.log("新数据:", deviceData);

    // 清除现有的设备牌子
    this.clearDeviceLabels();

    // 清除实例中的所有设备标签数据
    this.clearDeviceLabelsFromInstance();

    // 保存新的数据到实例
    this.saveDeviceLabelsToInstance(deviceData);

    // 为每个设备创建新的牌子
    deviceData.forEach((device) => {
      this.createDeviceLabel(device);
    });

    console.log("设备标签更新完成");
  }

  /**
   * 清除所有设备牌子
   */
  clearDeviceLabels() {
    console.log("开始清除设备牌子...");
    console.log(
      "当前设备牌子数量:",
      this.deviceLabels ? this.deviceLabels.length : 0
    );

    if (this.deviceLabels && this.deviceLabels.length > 0) {
      this.deviceLabels.forEach((label, index) => {
        console.log(`清除第 ${index + 1} 个设备牌子:`, label.code);

        // 清除DOM元素
        if (label.element) {
          console.log(`移除DOM元素: ${label.code}`);
          label.element.remove();
          label.element = null;
        }

        // 清除CSS2D对象
        if (label.css2dObject) {
          console.log(`从场景移除CSS2D对象: ${label.code}`);

          // 确保从父对象中移除
          if (label.css2dObject.parent) {
            label.css2dObject.parent.remove(label.css2dObject);
          }

          // 从场景中移除
          this.scene.remove(label.css2dObject);

          // 清理CSS2D对象的引用
          label.css2dObject = null;
        }

        // 清理设备对象引用
        if (label.deviceObject) {
          label.deviceObject = null;
        }
      });

      // 清空数组
      this.deviceLabels = [];
      console.log("设备牌子数组已清空");
    } else {
      console.log("没有设备牌子需要清除");
    }

    // 强制清理场景中可能残留的CSS2D对象
    this.scene.traverse((object) => {
      if (object.name && object.name.startsWith("device-label-")) {
        console.log(`发现残留的CSS2D对象: ${object.name}，正在移除...`);
        this.scene.remove(object);
      }
    });

    // 清理CSS2D渲染器DOM元素中可能残留的设备标签
    const css2dRenderer = document.getElementById("css2dRenderer");
    if (css2dRenderer) {
      const deviceLabels = css2dRenderer.querySelectorAll(
        ".device-label-container"
      );
      console.log(
        `在CSS2D渲染器中发现 ${deviceLabels.length} 个残留的设备标签DOM元素`
      );
      deviceLabels.forEach((label, index) => {
        console.log(`移除残留的DOM元素 ${index + 1}:`, label);
        label.remove();
      });
    }

    console.log("设备牌子清除完成");
  }

  /**
   * 清除所有设备牌子并清除实例数据
   * @param {Array} deviceCodes - 要清除的设备编号数组，如果不传则清除所有数据
   */
  clearDeviceLabelsAndInstance(deviceCodes = null) {
    this.clearDeviceLabels();
    this.clearDeviceLabelsFromInstance(deviceCodes);
  }

  /**
   * 创建单个设备牌子
   * @param {Object} device - 设备数据
   */
  createDeviceLabel(device) {
    const { name, visible = true, code, configs = [] } = device;

    // 根据code查找对应的设备对象
    const deviceObject = this.findDeviceByCode(code);
    if (!deviceObject) {
      console.warn(`未找到设备编号为 ${code} 的设备`);
      return;
    }

    // 创建牌子容器
    const labelContainer = document.createElement("div");
    labelContainer.className = "device-label-container";

    // 创建牌子主体
    const labelMain = document.createElement("div");
    labelMain.className = "device-label-main";

    // 创建设备名称
    const nameElement = document.createElement("div");
    nameElement.className = "device-label-name";
    nameElement.textContent = name;
    labelMain.appendChild(nameElement);

    // 创建配置信息
    if (configs && configs.length > 0) {
      const configContainer = document.createElement("div");
      configContainer.className = "device-label-configs";

      configs.forEach((config) => {
        const configItem = document.createElement("div");
        configItem.className = "device-label-config-item";

        const keyElement = document.createElement("span");
        keyElement.className = "device-label-config-key";
        keyElement.textContent = config.key + ": ";

        const valueElement = document.createElement("span");
        valueElement.className = "device-label-config-value";
        valueElement.textContent = config.value;

        configItem.appendChild(keyElement);
        configItem.appendChild(valueElement);
        configContainer.appendChild(configItem);
      });

      labelMain.appendChild(configContainer);
    }

    // 创建装饰元素
    const labelTop = document.createElement("div");
    labelTop.className = "device-label-top";

    const labelBottom = document.createElement("div");
    labelBottom.className = "device-label-bottom";

    const labelBottomDown = document.createElement("div");
    labelBottomDown.className = "device-label-bottom-down";

    // 组装牌子
    labelContainer.appendChild(labelMain);
    labelContainer.appendChild(labelTop);
    labelContainer.appendChild(labelBottom);
    labelContainer.appendChild(labelBottomDown);

    // 创建CSS2D对象
    const css2dObject = createCSS2DObject(
      labelContainer,
      `device-label-${code}`
    );

    // 计算设备包围盒的最高点中间位置
    const boundingBox = new THREE.Box3().setFromObject(deviceObject);
    const devicePosition = new THREE.Vector3();

    // 获取包围盒的中心点
    boundingBox.getCenter(devicePosition);

    // 将Y坐标设置为包围盒的最高点
    devicePosition.y = boundingBox.max.y;

    // 在最高点上方添加一点偏移，避免标签与设备重叠
    // devicePosition.y += 0.5;

    // 调试信息：输出包围盒信息
    console.log(`设备 ${code} 包围盒信息:`, {
      min: boundingBox.min.toArray(),
      max: boundingBox.max.toArray(),
      center: devicePosition.toArray(),
      deviceName: deviceObject.name,
    });

    css2dObject.position.copy(devicePosition);

    // 设置可见性
    css2dObject.visible = visible;

    // 添加到场景
    this.scene.add(css2dObject);

    // 保存引用
    if (!this.deviceLabels) {
      this.deviceLabels = [];
    }
    this.deviceLabels.push({
      code,
      element: labelContainer,
      css2dObject,
      deviceObject,
    });
  }

  /**
   * 根据设备编号查找设备对象
   * @param {string} code - 设备编号
   * @returns {THREE.Object3D|null} 设备对象
   */
  findDeviceByCode(code) {
    if (!this.currentFloor || !this.buildingObject[this.currentFloor.name]) {
      return null;
    }

    const children = this.buildingObject[this.currentFloor.name].group.children;

    for (const child of children) {
      // 检查设备名称是否包含设备编号
      const deviceCode = child.name.split("_")[0];
      if (deviceCode === code) {
        return child;
      }
    }

    return null;
  }

  /**
   * 显示指定楼层的指定标签
   * @param {string} floorName - 楼层名称
   * @param {string} labelName - 标签名称
   */
  showQiehuanLabel(floorName, labelName) {
    if (this.simpleLabel[floorName] && this.simpleLabel[floorName][labelName]) {
      const label = this.simpleLabel[floorName][labelName];
      label.css2dObject.visible = true;
      label.element.style.display = "block";
      console.log(`显示楼层 ${floorName} 的切换标签: ${labelName}`);
    }
  }

  /**
   * 隐藏指定楼层的指定标签
   * @param {string} floorName - 楼层名称
   * @param {string} labelName - 标签名称
   */
  hideQiehuanLabel(floorName, labelName) {
    if (this.simpleLabel[floorName] && this.simpleLabel[floorName][labelName]) {
      const label = this.simpleLabel[floorName][labelName];
      label.css2dObject.visible = false;
      label.element.style.display = "none";
      console.log(`隐藏楼层 ${floorName} 的切换标签: ${labelName}`);
    }
  }

  /**
   * 显示指定楼层的所有标签
   * @param {string} floorName - 楼层名称
   */
  showFloorLabels(floorName) {
    if (this.simpleLabel[floorName]) {
      Object.keys(this.simpleLabel[floorName]).forEach((labelName) => {
        this.showQiehuanLabel(floorName, labelName);
      });
      console.log(`显示楼层 ${floorName} 的所有切换标签`);
    }
  }

  /**
   * 隐藏指定楼层的所有标签
   * @param {string} floorName - 楼层名称
   */
  hideFloorLabels(floorName) {
    if (this.simpleLabel[floorName]) {
      Object.keys(this.simpleLabel[floorName]).forEach((labelName) => {
        this.hideQiehuanLabel(floorName, labelName);
      });
      console.log(`隐藏楼层 ${floorName} 的所有切换标签`);
    }
  }

  /**
   * 显示所有切换标签
   */
  showAllQiehuanLabels() {
    Object.keys(this.simpleLabel).forEach((floorName) => {
      this.showFloorLabels(floorName);
    });
    console.log("显示所有切换标签");
  }

  /**
   * 隐藏所有切换标签
   */
  hideAllQiehuanLabels() {
    Object.keys(this.simpleLabel).forEach((floorName) => {
      this.hideFloorLabels(floorName);
    });
    console.log("隐藏所有切换标签");
  }

  /**
   * 清理所有切换标签
   */
  clearQiehuanLabels() {
    Object.keys(this.simpleLabel).forEach((floorName) => {
      Object.keys(this.simpleLabel[floorName]).forEach((labelName) => {
        const label = this.simpleLabel[floorName][labelName];
        if (label.element) {
          label.element.remove();
        }
        if (label.css2dObject) {
          this.scene.remove(label.css2dObject);
        }
      });
    });
    this.simpleLabel = {};
    console.log("清理所有切换标签");
  }

  /**
   * 更新工艺和工艺牌子颜色
   * @param {Array} designData - 设计数据数组，包含 {code, name, status}
   */
  updateDesign(designData) {
    if (!Array.isArray(designData)) {
      console.warn("updateDesign 参数格式错误，应为数组");
      return;
    }

    console.log("开始更新工艺设计，数据:", designData);

    // 存储设计数据（按 code 索引，便于后续检索）
    designData.forEach((design) => {
      const { code } = design;
      if (code) {
        this.designDataMap[code] = design;
        console.log(`存储工艺设计数据: ${code}`, design);
      } else {
        console.warn("设计数据缺少 code 字段:", design);
      }
    });

    // 如果当前有楼层，立即应用数据
    if (this.currentFloor && this.currentFloor.name) {
      this.applyStoredDesignData(this.currentFloor.name);
    } else {
      console.log("当前没有楼层，数据已存储，将在楼层切换后自动应用");
    }

    console.log("工艺设计数据存储完成，当前存储的数据:", this.designDataMap);
  }

  /**
   * 从存储的数据中检索并应用设计数据到指定楼层
   * @param {string} floorName - 楼层名称
   */
  applyStoredDesignData(floorName) {
    if (!floorName || !this.simpleLabel[floorName]) {
      console.log(`楼层 ${floorName} 不存在或标签未初始化`);
      return;
    }

    const floorLabels = this.simpleLabel[floorName];
    if (!floorLabels) {
      console.log(`楼层 ${floorName} 没有标签数据`);
      return;
    }

    console.log(`开始为楼层 ${floorName} 应用存储的设计数据`);

    // 遍历存储的设计数据
    Object.keys(this.designDataMap).forEach((code) => {
      const design = this.designDataMap[code];
      
      // 验证设计数据是否存在
      if (!design || typeof design !== 'object') {
        console.warn(`设计数据无效 (code: ${code}):`, design);
        return;
      }

      const { name, status } = design;

      // 查找对应的标签
      // 方法1：直接通过 code 查找（code 对应 labelName）
      let labelInfo = floorLabels[code];

      // 方法2：如果直接查找不到，遍历查找设备对象的 name
      if (!labelInfo) {
        const foundKey = Object.keys(floorLabels).find((labelName) => {
          const deviceObj = floorLabels[labelName]?.deviceObject;
          if (deviceObj && deviceObj.name) {
            // 提取设备对象的 code（去掉 _shebei 后缀）
            let deviceCode = deviceObj.name;
            if (deviceObj.name.includes("_shebei")) {
              deviceCode = deviceObj.name.split("_shebei")[0];
            } else if (deviceObj.name.includes("_")) {
              deviceCode = deviceObj.name.split("_")[0];
            }
            // 检查是否匹配
            return deviceCode === code;
          }
          return false;
        });

        if (foundKey) {
          labelInfo = floorLabels[foundKey];
        }
      }

      if (labelInfo) {
        this.updateSingleDesign(labelInfo, name, status, code);
        console.log(`楼层 ${floorName} 的工艺 ${code} 已应用设计数据`);
      } else {
        // 不在当前楼层的设备，不输出警告（这是正常的）
        // console.log(`楼层 ${floorName} 未找到 code 为 ${code} 的工艺标签`);
      }
    });

    console.log(`楼层 ${floorName} 的设计数据应用完成`);
  }

  /**
   * 更新单个工艺和牌子的颜色
   * @param {Object} labelInfo - 标签信息对象 {element, css2dObject, deviceObject}
   * @param {string} name - 牌子显示的名称
   * @param {string} status - 状态颜色（十六进制字符串）
   * @param {string} code - 工艺代码
   */
  updateSingleDesign(labelInfo, name, status, code) {
    if (!labelInfo) {
      console.warn("标签信息不存在");
      return;
    }

    // 验证 status 参数
    if (!status || typeof status !== 'string') {
      console.warn(`工艺 ${code} 的状态颜色无效: ${status}，跳过颜色更新`);
      // 如果只有名称，仍然可以更新名称
      if (name && labelInfo.element) {
        this.updateLabelElement(labelInfo.element, name, null);
      }
      return;
    }

    const { element, css2dObject, deviceObject } = labelInfo;

    // 1. 更新工艺模型（deviceObject）的颜色
    if (deviceObject) {
      this.updateDeviceObjectColor(deviceObject, status);
    } else {
      console.warn(`设备对象不存在 (code: ${code})`);
    }

    // 2. 更新工艺牌子（element）的颜色和文本
    if (element) {
      this.updateLabelElement(element, name, status);
    } else {
      console.warn(`标签元素不存在 (code: ${code})`);
    }

    console.log(`工艺 ${code} 更新完成: 名称=${name}, 颜色=${status}`);
  }

  /**
   * 更新设备对象（工艺模型）的颜色
   * @param {THREE.Object3D} deviceObject - 设备对象
   * @param {string} colorHex - 颜色值（十六进制字符串，如 '#000000'）
   */
  updateDeviceObjectColor(deviceObject, colorHex) {
    if (!deviceObject) return;
    // 验证颜色值
    if (!colorHex || typeof colorHex !== 'string') {
      console.warn(`无效的颜色值: ${colorHex}，跳过模型颜色更新`);
      return;
    }

    const color = new THREE.Color(colorHex);

    // 遍历设备对象的所有 mesh，更新材质颜色
    deviceObject.traverse((child) => {
      if (child.isMesh && child.material) {
        // 处理材质数组
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((material) => {
          if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
            // 使用自发光（emissive）来添加一层淡淡的颜色覆盖，而不是完全替换原色
            // 这样可以保留原始材质的纹理和细节，同时用颜色来区分
            material.emissive.copy(color);
            material.emissiveIntensity = 0.45; // 设置较低的自发光强度，让颜色更柔和
            
            // 可选：轻微调整基础颜色，但保持原色的主色调
            // 将新颜色混合到原色中，使用较低的混合比例
            if (material.color) {
              const originalColor = material.color.clone();
              // 混合原色和新颜色（10% 新颜色 + 90% 原色）
              material.color.lerp(color, 0.1);
            }
            
            material.needsUpdate = true;
          }
        });
      }
    });
  }

  /**
   * 更新标签元素（工艺牌子）的颜色和文本
   * @param {HTMLElement} element - 标签DOM元素
   * @param {string} name - 要显示的名称
   * @param {string} colorHex - 颜色值（十六进制字符串，可选）
   */
  updateLabelElement(element, name, colorHex) {
    if (!element) return;

    // 更新文本内容（如果有 name 参数）
    if (name) {
      // 查找显示名称的元素
      const nameSpan = element.querySelector("span");
      if (nameSpan) {
        nameSpan.textContent = name;
      } else {
        // 如果没有 span，直接更新 element 的文本内容
        const textNode = Array.from(element.childNodes).find(
          (node) => node.nodeType === Node.TEXT_NODE
        );
        if (textNode) {
          textNode.textContent = name;
        }
      }
    }

    // 更新颜色样式（如果有 colorHex 参数）
    if (colorHex && typeof colorHex === 'string') {
      // 将十六进制颜色转换为 RGB
      const rgb = this.hexToRgb(colorHex);
      if (rgb) {
        // 更新背景色和边框色
        element.style.borderColor = colorHex;
        // 更新文本阴影颜色（使用稍亮一点的颜色）
        const brighterColor = this.brightenColor(colorHex, 1.2);
        element.style.textShadow = `0 1px 2px ${brighterColor}`;
        // 更新渐变背景（可选，如果需要）
        // element.style.background = `linear-gradient(135deg, ${this.addAlpha(colorHex, 0.1)}, ${this.addAlpha(colorHex, 0.05)})`;
      }
    }
  }

  /**
   * 将十六进制颜色转换为 RGB
   * @param {string} hex - 十六进制颜色值
   * @returns {Object|null} {r, g, b} 或 null
   */
  hexToRgb(hex) {
    // 验证参数
    if (!hex || typeof hex !== 'string') {
      console.warn(`hexToRgb: 无效的颜色值: ${hex}`);
      return null;
    }

    // 移除 # 号
    const cleanHex = hex.replace("#", "");
    
    // 处理3位和6位十六进制
    const match = cleanHex.length === 3
      ? cleanHex.match(/^([a-f\d])([a-f\d])([a-f\d])$/i)
      : cleanHex.length === 6
      ? cleanHex.match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
      : null;

    if (!match) {
      console.warn(`hexToRgb: 无效的颜色格式: ${hex}`);
      return null;
    }

    return {
      r: cleanHex.length === 3
        ? parseInt(match[1] + match[1], 16)
        : parseInt(match[1], 16),
      g: cleanHex.length === 3
        ? parseInt(match[2] + match[2], 16)
        : parseInt(match[2], 16),
      b: cleanHex.length === 3
        ? parseInt(match[3] + match[3], 16)
        : parseInt(match[3], 16),
    };
  }

  /**
   * 增亮颜色
   * @param {string} hex - 十六进制颜色值
   * @param {number} factor - 增亮系数（>1为增亮，<1为变暗）
   * @returns {string} 新的十六进制颜色值
   */
  brightenColor(hex, factor) {
    if (!hex || typeof hex !== 'string') {
      console.warn(`brightenColor: 无效的颜色值: ${hex}`);
      return hex || '#ffffff'; // 返回原始值或默认白色
    }

    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;

    const newR = Math.min(255, Math.round(rgb.r * factor));
    const newG = Math.min(255, Math.round(rgb.g * factor));
    const newB = Math.min(255, Math.round(rgb.b * factor));

    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  /**
   * 处理设备点击事件
   * @param {string} deviceCode - 设备名称
   */
  async handleDeviceClick(deviceCode) {
    // 防止重复调用
    if (this._isHandlingDeviceClick) {
      console.log("设备点击处理正在进行中，忽略重复调用");
      return;
    }

    this._isHandlingDeviceClick = true;

    try {
      // 重置右键双击事件时间戳，确保每次设备点击都有干净的状态
      this.resetRightClickTimestamps();

      // 发送设备选择消息
      web3dSelectCode(deviceCode);

      // 查找设备所在的楼层
      let targetFloor = null;
      let targetObj = null;
      let targetFloorData = null;

      // 通过 simpleInsert 查找设备所在楼层
      for (const [floorName, floorData] of Object.entries(this.simpleInsert)) {
        if (floorData && Array.isArray(floorData)) {
          targetObj = floorData.find(
            (device) => device.name.split("_")[0] === deviceCode
          );
          if (targetObj) {
            targetFloor = floorName;
            targetFloorData = floorData;
            break;
          }
        }
      }
      // 如果没找到设备，直接返回
      if (!targetFloor || !targetObj) {
        console.warn(`未找到设备: ${deviceCode}`);
        return;
      }

      // 如果设备不在当前楼层，先切换到对应楼层
      if (!this.currentFloor || this.currentFloor.name !== targetFloor) {
        console.log(
          `设备 ${deviceCode} 不在当前楼层，切换到楼层 ${targetFloor}`
        );
        // 切换到目标楼层，但不重新设置射线检测事件
        await this.changeFloorWithoutReSetupEvents(targetFloor);
      } else {
        console.log(`设备 ${deviceCode} 在当前楼层 ${targetFloor}，无需切换`);
        // 确保当前楼层的右键双击事件正常工作
        if (
          !this._indoorRaycastClearFns ||
          this._indoorRaycastClearFns.length === 0
        ) {
          console.log("当前楼层缺少射线检测事件，重新设置");
          this.setupFloorRaycastEvents(targetFloor);
        }
      }

      // 获取当前楼层的所有设备对象
      const children = targetFloorData;

      // 拉近视角到当前点击设备
      await this.cameraMoveQiehuan(targetObj);

      // 清除所有设备的outline
      this.core.postprocessing.clearOutlineAll(1);

      children.forEach((obj) => {
        if (obj === targetObj) {
          // 获取目标对象的标签名称
          const targetLabelName = targetObj.name.split("_shebei")[0];

          // 先隐藏当前楼层的所有标签
          this.hideFloorLabels(targetFloor);
          
          // 只显示匹配的标签
          this.showQiehuanLabel(targetFloor, targetLabelName);

          // 为当前点击的设备添加outline
          this.core.postprocessing.addOutline(targetObj, 1);
        } else {
          // 其他设备移除outline（通过clearOutlineAll已经处理）
        }
      });

      console.log(`设备 ${deviceCode} 点击处理完成`);
    } catch (error) {
      console.error("处理设备点击时发生错误:", error);
    } finally {
      // 确保处理完成后重置标志
      this._isHandlingDeviceClick = false;
    }
  }

  /**
   * 切换楼层但不重新设置射线检测事件（避免重复注册右键双击事件）
   * @param {string} floor - 目标楼层名称
   */
  async changeFloorWithoutReSetupEvents(floor) {
    return new Promise((resolve, reject) => {
      if (!this.buildingObject || !this.buildingObject[floor]) {
        console.warn(`楼层 "${floor}" 的建筑数据尚未加载完成，请稍后再试`);
        reject(new Error(`楼层 "${floor}" 的建筑数据尚未加载完成`));
        return;
      }

      if (!this.endChangeFloor) {
        reject(new Error("楼层切换正在进行中"));
        return;
      }

      // 如果已经是目标楼层，直接返回成功
      if (
        this.currentFloor &&
        this.currentFloor.name === floor &&
        this.endChangeFloor
      ) {
        console.log(`已经在目标楼层 ${floor}，无需切换`);
        this.syncGroundDeviceIconVisibility(floor);
        resolve();
        return;
      }

      this.core.resetRightDblClickState();

      this.resetData();

      // 清理当前楼层的设备标签
      this.clearDeviceLabels();

      // 清理切换标签（牌子）
      this.hideAllQiehuanLabels();

      if (!this.currentFloor) {
        this.endChangeFloor = false;
        this.switchFloorAnimate(floor)
          .then((res) => {
            if (
              window.configs.floorToName[this.buildingName + "_室内"] &&
              window.configs.floorToName[this.buildingName + "_室内"][floor]
            ) {
              changeIndoor(
                window.configs.floorToName[this.buildingName + "_室内"][floor]
              );
            }
            super.updateOrientation();
            this.core.crossSearch.changeSceneSearch();
            this.endChangeFloor = true;
            this.gatherOrSilentShader();

            // 在楼层切换动画完成后加载设备标签数据
            this.loadAndRenderDeviceLabels();

            // 显示当前楼层的标签
            this.showFloorLabels(floor);

            this.syncGroundDeviceIconVisibility(floor);

            // 从存储的数据中检索并应用设计数据
            this.applyStoredDesignData(floor);

            // 注意：这里不重新设置射线检测事件，保持现有的事件监听
            this.sceneHint.updateMessage("右键双击恢复楼栋");

            // 楼层切换完成，解析Promise
            resolve();
          })
          .catch((error) => {
            this.endChangeFloor = true;
            reject(error);
          });
        this.buildingAnimate(floor);
      } else {
        // 如果已经有当前楼层，执行楼层内部切换
        this.floorSwitchInnerWithoutReSetupEvents(floor)
          .then(() => {
            // 楼层内部切换完成，解析Promise
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      }
    });
  }

  /**
   * 楼层内部切换但不重新设置射线检测事件
   * @param {string} target - 目标楼层名称
   */
  floorSwitchInnerWithoutReSetupEvents(target) {
    return new Promise((resolve, reject) => {
      if (
        !this.buildingObject ||
        !this.buildingObject[target] ||
        !this.buildingObject[target].group
      ) {
        console.error(
          `楼层 "${target}" 的建筑数据不完整，无法执行楼层内部切换`
        );
        reject(new Error(`楼层 "${target}" 的建筑数据不完整`));
        return;
      }

      this.endChangeFloor = false;
      const group = this.buildingObject[target].group;
      const { min, max } = getBoxCenter(group);
      lightIndexReset();
      lightIndexUpdate(max.y, min.y);

      // 清理切换标签（牌子）
      this.hideAllQiehuanLabels();

      let lastFloor = this.currentFloor.name;
      this.buildingObject[lastFloor].uTime.value = 0.2;
      this.buildingObject[target].group.visible = true;
      this.buildingObject[target].uTime.value = 1;

      new TWEEN.Tween(this.buildingObject[lastFloor].uTime)
        .to({ value: 0.0 }, 1000)
        .start()
        .onComplete(() => {
          this.buildingObject[lastFloor].group.visible = false;
        });

      this.currentFloor = group;
      this.cameraMoveToFloor(group)
        .then(() => {
          super.updateOrientation();
          this.core.crossSearch.changeSceneSearch();
          this.endChangeFloor = true;

          // 在楼层内部切换完成后加载设备标签数据
          this.loadAndRenderDeviceLabels();

          // 显示当前楼层的标签
          this.showFloorLabels(target);

          // 室外设备模型：仅当前楼层 CSS2D 图标可见
          this.syncGroundDeviceIconVisibility(target);

          // 从存储的数据中检索并应用设计数据
          this.applyStoredDesignData(target);

          // 重新注册右键双击事件，确保事件监听正常工作
          this.setupFloorRaycastEvents(target);

          // 楼层内部切换完成，解析Promise
          resolve();
        })
        .catch((error) => {
          this.endChangeFloor = true;
          reject(error);
        });
    });
  }
}
