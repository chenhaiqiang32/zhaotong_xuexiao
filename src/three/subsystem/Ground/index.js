import * as THREE from "three";
import { CustomSystem } from "../customSystem";
import { loadGLTF } from "../../loader";
import { EscapeRoutePlate } from "./../../components/gather/escapeRouteLine";

import { Store3D } from "../..";
import {
  dblclickBuilding,
  getBuildingDetail,
  changeIndoor,
  postBuildingId,
  web3dModelsGroup,
} from "../../../message/postMessage";
import { loadTexture } from "../../../utils/texture";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SunnyTexture, Weather } from "../../components/weather";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { createInstanceMesh } from "../../../lib/InstanceMesh";
import { getBoxCenter } from "../../../lib/box3Fun";
import { createBuildingInfoLabel, createBuildingNameLabel } from "./boardTitle";

import EquipmentPlate from "../../components/business/equipMentPlate";
import { MeasureDistance } from "../../components/measureDistance";

import { MeasureArea } from "../../components/measureArea";
import { FencePlate } from "../../components/business/fencePlate/fence";
import {
  autoRotate,
  processingCameraAnimation,
} from "../../processing/modelProcess";
import { modelProcess } from "../../processing";
import { GatherOrSilentFence } from "../../components/business/fencePlate/gatherOrSilentFence";
import { MeetingPointPlate } from "../../components/business/equipMentPlate/meetingPoint";
import { modelFiles, buildingNames } from "../../../assets/modelList";
import { Tooltip } from "../../components/Tooltip";
import { SceneHint } from "../../components/SceneHint";
import { BuildingHoverRings } from "../../../lib/BuildingHoverRings";
import { glassEffect } from "../../../shader";

// 获取模型文件列表
async function getModelFiles() {
  try {
    const response = await fetch("/models/outDoor");
    const files = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(files, "text/html");
    const links = Array.from(doc.getElementsByTagName("a"));

    return links
      .map((link) => link.href)
      .filter((href) => href.endsWith(".glb"))
      .map((href) => href.split("/").pop());
  } catch (error) {
    console.error("Error fetching model files:", error);
    return [];
  }
}

export const ground = Symbol();
const fenceSymbol = Symbol();

const center = new THREE.Vector3();
const CAMERA_SPHERE = new THREE.Sphere(center, 2880);
const CONTROLS_SPHERE = new THREE.Sphere(center, 2880);

/**@type {OrbitControls} */
const controlsParameters = {
  maxPolarAngle: Math.PI / 2,
};

/**@classdesc 地面广场子系统 */
export class Ground extends CustomSystem {
  /** @param {Store3D} core*/
  constructor(core) {
    super(core);

    this.tweenControl = core.tweenControl;
    // 移除原来的背景设置，使用 RoomEnvironment 设置
    // this.scene.background = SunnyTexture;
    // 设置环境贴图，确保在模型加载前可用
    // this.setHDRSky();
    this.onRenderQueue = core.onRenderQueue;
    this.controls = core.controls;
    this.baseCamera = core.baseCamera;
    this.camera = core.camera;
    this.orientation = core.orientation;
    this.buildingModel = null;
    /** 室内建筑外壳是否处于半透明透视状态 */
    this.buildingShellTransparent = false;
    this.boxSelect = core.orientation.boxSelect;
    this.postprocessing = core.postprocessing;

    this.buildingMeshArr = [];
    this.buildingMeshObj = {};
    this.buildingNames = buildingNames;

    this.bloomLights = [];
    this.buildingNameLabelMap = {};
    this.buildingNum = {};
    this.singleBuildingGroup = {};
    this.labelGroup = new THREE.Group();
    this.labelGroup.name = "labelGroupHome";
    this._add(this.labelGroup);

    this.groundMesh = null;
    this.cameraResetModel = null;
    this.fencePlate = null;
    this.gatherOrSilentPlate = null;
    this.eventClear = [];
    this.pointerArr = [];
    this.isLoaded = false;
    this.searchBuildingId = null;

    this.roamEnabled = false;
    this.roamDuration = 10;
    this.filterBuildingArr = ["buildingBoard"];
    this.boxSelectStatus = false;

    this.instancedMesh = [];
    this.altitude = -20;
    this.modelList = [];
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.loadedModels = new Map();

    // 初始化提示框
    this.tooltip = new Tooltip();
    this.labelGroup.add(this.tooltip.css2dObject);

    // 初始化场景提示
    this.sceneHint = new SceneHint();

    // 初始化建筑悬停环形圆圈
    this.buildingHoverRings = new BuildingHoverRings();
    this.scene.add(this.buildingHoverRings);

    // 初始化工艺标签存储（类似室内场景的 simpleLabel）
    this.simpleLabel = {};

    this.init();
  }

  async init() {
    console.log("Ground system initializing...");
    try {
      // 创建模型配置数组
      const modelConfigs = modelFiles.map((modelFile) => ({
        name: modelFile.replace(".glb", ""),
        path: `./models/outDoor/${modelFile}`,
        type: ".glb",
      }));

      console.log("Loading models with configs:", modelConfigs);
      this.initLight();
      // 使用 loadGLTF 加载模型
      await loadGLTF(
        modelConfigs,
        (gltf, name) => {
          if (!gltf || !gltf.scene) {
            console.error(`❌ 模型加载失败: ${name} - 无效的模型数据`);
            return;
          }
          console.log(`✅ 成功加载模型: ${name}`);
          this.onProgress(gltf, name);
        },
        () => {
          console.log("✅ 所有模型加载完成");
          this.initComponents(); // 在模型加载完成后初始化组件
          this.onLoaded();
        }
      );

      // 移除 loading 状态
    } catch (error) {
      console.error("❌ 加载模型时出错:", error);
      // 显示更详细的错误信息
      if (error.response) {
        console.error("响应状态:", error.response.status);
        console.error("响应头:", error.response.headers);
      }
      throw error;
    }
  }

  /**
   * 初始化各个组件 - 在模型加载完成后调用
   */
  initComponents() {
    // 初始化各个组件
    this.fencePlate = new FencePlate(this.scene, this);
    this.escapeRoute = new EscapeRoutePlate(this.scene, this);
    this.gatherOrSilentPlate = new GatherOrSilentFence(this.scene, this);
    this.meetingPoint = new MeetingPointPlate(this.scene, this);

    console.log("Creating Weather instance with this:", this);
    console.log("Ground scene:", this.scene);
    // console.log("Weather instance created:", this.weather);

    this.measureDistance = new MeasureDistance(this);
    this.measureArea = new MeasureArea(this);

    // 设置渲染队列
    if (this.core && this.core.onRenderQueue) {
      this.core.onRenderQueue.set("ground", this.update.bind(this));

      if (this.gatherOrSilentPlate) {
        this.core.onRenderQueue.set(
          "gatherOrSilentFence",
          this.gatherOrSilentPlate.update.bind(this.gatherOrSilentPlate)
        );
      }

      if (this.escapeRoute) {
        this.core.onRenderQueue.set(
          "escapeRoute",
          this.escapeRoute.update.bind(this.escapeRoute)
        );
      }
    }
  }

  limitCameraInSphere = () => {
    if (this.controls.enableRotate) {
      this.camera.position.clampSphere(CAMERA_SPHERE);
      this.controls.target.clampSphere(CONTROLS_SPHERE);

      this.camera.position.y =
        this.camera.position.y < this.altitude
          ? this.altitude
          : this.camera.position.y;
      this.controls.target.y =
        this.controls.target.y < this.altitude
          ? this.altitude
          : this.controls.target.y;
    } else {
      // const radius = CAMERA_SPHERE.radius;
      // this.camera.position.y = this.camera.position.y >= radius ? radius : this.camera.position.y;
      // this.camera.position.y = this.camera.position.y <= -radius ? -radius : this.camera.position.y;
    }
  };

  handleControls() {
    this.controls.addEventListener("change", this.limitCameraInSphere);
    Reflect.ownKeys(controlsParameters).forEach((key) => {
      this.controls.data[key] = this.controls[key];
      this.controls[key] = controlsParameters[key];
    });
  }

  resetControls() {
    this.controls.removeEventListener("change", this.limitCameraInSphere);
    Reflect.ownKeys(controlsParameters).forEach((key) => {
      this.controls[key] = this.controls.data[key];
    });
  }

  setCameraState(state) {
    if (!this.useCameraState) return;

    const { begin, updateCameraState, stop } = this.useCameraState();

    /**更新相机漫游 */
    updateCameraState(this.roamDuration);

    /**开启或结束相机漫游 */
    if (state && this.core.currentSystem === this) {
      begin();
    } else {
      stop();
    }
  }

  addEventListener() {
    if (this.eventClear.length > 0) return; // eventClear队列大于0说明已经绑定过事件s

    // 正常状态下事件绑定
    let dblclick = this.core.raycast(
      "dblclick",
      this.buildingMeshArr,
      (intersects) => {
        if (intersects.length) {
          // 获取射线检测到的对象
          const intersectedMesh = intersects[0].object;
          // 向上查找父级，直到找到建筑模型
          let current = intersectedMesh;
          while (
            current.parent &&
            !this.buildingNames.some((name) => current.name === name)
          ) {
            current = current.parent;
          }

          if (
            !this.boxSelectStatus &&
            this.buildingNames.some((name) => current.name === name)
          ) {
            dblclickBuilding(current.name.split("_")[0]); // 通知前端我们即将进入室内，前端借此关闭一些弹窗
            this.core.changeSystem("indoorSubsystem", current.name);
          }
        }
      }
    );

    // this.core.raycast("click", this.groundMesh, (intersects) => {
    //   if (intersects.length) {
    //     console.log(intersects[0].point, "位置坐标");
    //   }
    // });

    this.addGroundEvent();
    let rightCancel = this.core.rightDblClickListener(() => {
      this.resetCamera();
    });
    this.eventClear.push(dblclick.clear);
    this.eventClear.push(rightCancel);

    Object.values(this.buildingNum).forEach((child) => {
      child.element.onclick = () => this.buildingNumClick(child.name);
    });

    const cameraLerpTo = this.core.raycast(
      "dblclick",
      this.groundMesh,
      (intersects) => {
        if (intersects.length && !this.boxSelectStatus) {
          this.tweenControl.lerpTo(
            intersects[0].point,
            50,
            1000,
            new THREE.Vector3(0, 10, 0)
          );
        }
      }
    );
    this.eventClear.push(cameraLerpTo.clear);
  }

  groundClickEvent(ray) {
    let buildingInserts = ray.intersectObjects(this.buildingMeshArr);
    if (buildingInserts.length) {
      const intersectedMesh = buildingInserts[0].object;
      if (intersectedMesh.userData.buildingName) {
        const buildingName = intersectedMesh.userData.buildingName;
        console.log("groundClickEvent: 点击建筑", buildingName);
        console.log(
          "buildingNameLabelMap keys:",
          Object.keys(this.buildingNameLabelMap)
        );

        // 检查建筑名称是否存在于标签映射中
        if (this.buildingNameLabelMap[buildingName]) {
          this.commonSearchBuilding(buildingName);
        } else {
          console.warn(
            `groundClickEvent: 建筑名称 "${buildingName}" 在 buildingNameLabelMap 中不存在`
          );
        }
      }
    }
  }

  addGroundEvent() {
    let cancel = this.core.addClickCustom(this.groundClickEvent.bind(this));
    let mousemove = this.core.raycast(
      "mousemove",
      this.buildingMeshArr,
      (intersects) => {
        // 过滤
        if ((this.core.elapsedTime * 10) & 1) return;

        if (intersects.length) {
          const intersectedMesh = intersects[0].object;
          let current = intersectedMesh;
          while (
            current.parent &&
            !this.buildingNames.some((name) => current.name === name)
          ) {
            current = current.parent;
          }
          // 计算显示位置（在建筑上方）
          const position = new THREE.Vector3();
          intersectedMesh.getWorldPosition(position);
          position.y += 10; // 在建筑上方显示

          // 使用封装的方法显示建筑悬停效果
          this.showBuildingHoverEffect(current.name, position, current);
        } else {
          // 使用封装的方法隐藏建筑悬停效果
          this.hideBuildingHoverEffect();
        }
      }
    );
    let mousemovePointer = this.core.raycast(
      "mousemove",
      this.orientation.orientation3D.pointerArr,
      (intersects) => {
        if (intersects.length) {
          document.body.style.cursor = "pointer";
        } else {
          document.body.style.cursor = "auto";
        }
      }
    );
    // this.eventClear.push(cancel);
    this.eventClear.push(mousemovePointer.clear);
    this.eventClear.push(mousemove.clear);
  }

  onEnter() {
    // 北元版本 切换子场景时会重置composer饱和度亮度为白天的配置 切回主场景时需要重新更新原有设置
    // this.weather && this.weather.resetComposer(this.weather.lightingPattern);

    this.handleControls();
    EquipmentPlate.onLoad(this, this.core); // 设备系统
    this.boxSelect.onLoad(this);
    this.filterBuildingNum(); // 每次进入都要调用一下筛选

    // 重新创建提示框（如果在 onLeave 中被销毁了）
    if (!this.tooltip) {
      this.tooltip = new Tooltip();
      this.labelGroup.add(this.tooltip.css2dObject);
    }

    // 显示室外场景提示
    this.sceneHint.show("右键双击恢复默认视角");

    if (this.groundMesh) {
      this.onLoaded();
      this.isLoaded = true;
      this.setHDRSky();
    }
  }

  initDangerFence(data) {
    this.fencePlate.initDangerFence(data);
  }
  hideBuildingLabel(id = this.searchBuildingId) {
    let closeId = id || this.searchBuildingId;
    if (!closeId) {
      return false;
    }
    // 隐藏楼栋牌子
    this.buildingNameLabelMap[closeId].visible = false;
    this.buildingNameLabelMap[closeId].element.style.display = "none";
    this.searchBuildingId = null;
    this.postprocessing.clearOutlineAll(1);
  }
  hideAllBuildingLabel() {
    Object.values(this.buildingNameLabelMap).map((child) => {
      child.visible = false;
      child.element.style.display = "none";
    });
    Object.values(this.buildingNum).forEach((child) => {
      child.traverse((res) => {
        res.visible = false;
        child.element.style.display = "none";
      });
    });
    this.searchBuildingId = null;

    // 隐藏提示框
    if (this.tooltip) {
      this.tooltip.hide();
    }
  }
  clearDangerFence() {
    this.fencePlate.clearDangerFence();
  }
  clearBuildingFence() {
    this.fencePlate.clearBuildingFence();
  }
  // this.weather && this.weather.setWeather(param.type, param.level);
  // this.weather.switchWeather(param);
  // this.weather.updateLightingPattern(param);
  // if (this.weather) {
  //   this.weather.setBoundingBox(weatherBox);
  // }
  // this.weather.resetComposer();

  /**历史轨迹指令 */
  historyTrackCommand(param) {
    if (param.cmd === "trackInit") {
      this.orientation.orientation3D.hiddenAllPerson = true;
      this.orientation.updateModules();

      this.removeEventListener();
      this.postprocessing.clearOutlineAll();
    }
    if (param.cmd === "trackClear") {
      this.removeEventListener();

      if (!this.historyTrack.path) {
        this.addEventListener();
      }

      this.orientation.orientation3D.hiddenAllPerson = false;
      this.orientation.updateModules();
    }
    this.historyTrack.command(param);
  }
  /**开启测量功能,所有功能依赖当前系统 */
  startMeasuring() {
    this.removeEventListener();
    this.measureDistance.start();
  }
  /**移除测量功能,所有功能依赖当前系统 */
  removeMeasuring() {
    this.measureDistance.end();
    this.addEventListener();
    this.resetCamera();
  }
  /**开启测面积功能,所有功能依赖当前系统 */
  startMeasureArea() {
    this.removeEventListener();
    this.measureArea.start();
  }
  /**移除测面积功能,所有功能依赖当前系统 */
  removeMeasureArea() {
    this.measureArea.end();
    this.addEventListener();
    this.resetCamera();
  }
  changeBoxSelect(state) {
    this.boxSelectStatus = state;
    if (state) {
      this.removeEventListener();
      this.boxSelect.start();
    } else {
      this.boxSelect.end();
      this.addEventListener();
      this.resetCamera();
    }
  }

  searchBuilding(visible = true) {
    console.log("searchBuilding: 开始搜索建筑", this.searchBuildingId);
    console.log(
      "buildingNameLabelMap keys:",
      Object.keys(this.buildingNameLabelMap)
    );

    if (visible) {
      // 未建模的建筑不用通知显示前端牌子
      // 通知前端显示建筑弹窗
      getBuildingDetail(this.searchBuildingId);
    }

    let title = this.buildingNameLabelMap[this.searchBuildingId];
    if (title) {
      console.log("searchBuilding: 找到标签对象，调用boardClick");
      this.boardClick(title); // 视角拉近建筑
    } else {
      console.warn(
        `searchBuilding: 未找到建筑ID为 ${this.searchBuildingId} 的标签对象`
      );
      console.warn("可用的建筑ID:", Object.keys(this.buildingNameLabelMap));
    }

    this.postprocessing.clearOutlineAll(1);
    let pickBuilding = this.buildingMeshObj[this.searchBuildingId];
    if (pickBuilding) {
      this.postprocessing.addOutline(pickBuilding, 1);
    } else {
      console.warn(
        `searchBuilding: 未找到建筑ID为 ${this.searchBuildingId} 的建筑对象`
      );
    }
  }
  createFence(data) {
    this.fencePlate.create(data);
  }
  clearFence() {
    // 清空围栏
    this.fencePlate.dispose();
  }

  /**
   * @param {import("three/examples/jsm/loaders/GLTFLoader").GLTF} gltf
string} name
   * @returns
   */
  onProgress(gltf, name) {
    if (this.core.scene !== this.scene) return;
    const model = gltf.scene;

    // 处理模型材质

    if (name === "内地形") {
      const { min, max } = getBoxCenter(model);
      this.altitude = min.y;

      // 让地面模型接受阴影
      model.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
        }
      });

      // 设置地面网格
      this.groundMesh = model;

      // 计算相机初始位置并立即设置，避免后续动画时的闪烁
      const { radius, center } = getBoxCenter(model);
      center.y += radius * 0.24;

      const initialCameraPosition = new THREE.Vector3(
        center.x,
        center.y + radius * 0.8,
        center.z + radius * 2.5 // 距离建筑更远一些
      );
      const controlsTarget = center.clone();

      // 立即设置相机到初始位置
      this.camera.position.copy(initialCameraPosition);
      this.controls.target.copy(controlsTarget);
      this.camera.lookAt(controlsTarget);

      // 更新天气范围
      // if (this.weather) {
      //   // 创建一个比地面模型稍大的包围盒，确保天气效果覆盖整个场景
      //   const padding = 100; // 添加一些边距
      //   const weatherBox = new THREE.Box3(
      //     new THREE.Vector3(min.x - padding, min.y, min.z - padding),
      //     new THREE.Vector3(max.x + padding, max.y + 500, max.z + padding)
      //   );
      //   this.weather.setBoundingBox(weatherBox);
      // }
    }
    if (name === "text") {
      console.log(model, "model");
      model.children.forEach((child) => {
        this.buildingMeshArr.push(child);
        // 应用高亮发光效果
        this.applyGlowSignEffect(child);
      });
    }
    // 检查是否是建筑模型
    if (name === "室内模型外壳") {
      // 将建筑模型添加到场景
      model.children.forEach((childs) => {
        // 遍历模型的所有网格
        childs.traverse((child) => {
          if (child.isMesh) {
            // 设置网格属性
            child.castShadow = true;
            child.receiveShadow = true;
            // 调整材质属性（包括为 "bbll" 材质添加玻璃效果）
            this.adjustModelMaterials(child);
            // 将网格添加到射线检测数组
            this.buildingMeshArr.push(child);
            this.buildingMeshObj[child.name] = child;

            // 设置网格的用户数据，标记它属于哪个建筑
            child.userData.buildingName = name;
          }
        });
        // this.setBuildingBoard(childs);
      });
      this.cameraResetModel = model;
      this.buildingModel = model;

      // 为建筑模型添加探照灯光和点光源，模拟玻璃光照效果
      this.addBuildingLighting(model);
    }
    // 动画现在由全局动画管理器统一处理

    this._add(model);
  }

  /**
   * 调整模型材质属性
   * @param {THREE.Object3D} model 模型对象
   */
  adjustModelMaterials(child) {
    // 处理材质名称为 "bbll" 的材质，添加玻璃效果
    if (child.material.name === "bbll") {
      this.addGlassProperties(child.material);
    }
  }

  /**
   * 为模型应用高亮发光效果
   * @param {THREE.Object3D} object 需要应用效果的对象
   */
  applyGlowSignEffect(object) {
    object.traverse((child) => {
      if (child.isMesh) {
        // 获取原始材质颜色
        let originalColor = new THREE.Color(0xffffff); // 默认白色
        if (child.material) {
          if (child.material.color) {
            originalColor = child.material.color.clone();
          } else if (child.material.emissive) {
            originalColor = child.material.emissive.clone();
          }
        }

        // 创建发光着色器材质
        const glowMaterial = new THREE.ShaderMaterial({
          transparent: true,
          depthTest: false, // 关闭深度检测，避免被遮挡
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            uColor: { value: originalColor }, // 使用原始材质颜色
            uIntensity: { value: 1.8 }, // 发光强度
            // 如果原材质有贴图，保留它
            uTexture: {
              value: child.material.map || null,
            },
            uHasTexture: {
              value: child.material.map ? 1.0 : 0.0,
            },
          },
          vertexShader: `
             varying vec2 vUv;
             
             void main() {
               vUv = uv;
               gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
             }
           `,
          fragmentShader: `
             uniform vec3 uColor;
             uniform float uIntensity;
             uniform sampler2D uTexture;
             uniform float uHasTexture;
             
             varying vec2 vUv;
             
             void main() {
               // 基础颜色
               vec3 baseColor = uColor;
               
               // 如果有原始贴图，混合它
               if (uHasTexture > 0.5) {
                 vec3 textureColor = texture2D(uTexture, vUv).rgb;
                 baseColor = textureColor * baseColor;
               }
               
               // 高亮发光效果
               vec3 finalColor = baseColor * uIntensity;
               
               // 输出颜色
               gl_FragColor = vec4(finalColor, 1.0);
             }
           `,
        });

        // 替换原材质
        child.material = glowMaterial;

        // 设置渲染顺序，确保发光效果在最后渲染
        child.renderOrder = 1000;

        // 保存材质引用以便后续动画更新
        if (!this.glowMaterials) {
          this.glowMaterials = [];
        }
        this.glowMaterials.push(glowMaterial);

        console.log(`已为 ${child.name || "未命名模型"} 应用高亮发光效果`);
      }
    });
  }
  generateTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;

    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 1, 2, 1);

    return canvas;
  }
  /**
   * 调整单个材质属性
   * @param {THREE.Material} material 材质对象
   */
  adjustMaterial(material) {
    if (!material) return;
    const texture = new THREE.CanvasTexture(this.generateTexture());
    const hdrEquirect = new RGBELoader()
      .setPath("./")
      .load("royal_esplanade_1k.hdr", function () {
        hdrEquirect.mapping = THREE.EquirectangularReflectionMapping;
      });
    texture.magFilter = THREE.NearestFilter;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.set(1, 3.5);
    // 为材质名称为 "bl" 的材质应用物理材质
    if (material.name === "bl") {
      // 创建物理材质，类似 README.md 中的示例
      const physicalMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.8,
        roughness: 0.0,
        ior: 4.0,
        alphaMap: texture,
        envMap: hdrEquirect,
        transmission: 0.4,
        thickness: 1.0,
        specularIntensity: 12.0,
        specularColor: 0xffffff,
        envMapIntensity: 2.0,
        opacity: 0.8,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });

      // 设置环境贴图（如果场景环境贴图存在）
      // if (this.scene.environment) {
      //   physicalMaterial.envMap = this.scene.environment;
      //   physicalMaterial.envMapIntensity = 12.0;
      // }

      // 替换原材质
      return physicalMaterial;
    }

    // 如果 roughness 为 0，设置为 0.2
    if (material.roughness !== undefined && material.roughness === 0) {
      material.roughness = 0.2;
      console.log(
        `调整材质 ${material.name || "unnamed"} 的 roughness: 0 -> 0.2`
      );
    }

    // 如果 metalness 为 1，设置为 0.68 并添加环境贴图
    if (material.metalness !== undefined && material.metalness === 1) {
      material.metalness = 0.68;
    }

    // 为所有材质设置环境贴图（如果场景环境贴图存在）
    if (this.scene.environment) {
      material.envMap = this.scene.environment;
      material.envMapIntensity = 0.8; // 环境贴图强度
      material.needsUpdate = true; // 确保材质更新
      console.log(
        `为材质 ${material.name || "unnamed"} 设置环境贴图，强度: 0.8`
      );
    }
  }

  /**
   * 为原始材质添加玻璃属性，实现反光玻璃效果
   * @param {THREE.Material} material 原始材质
   */
  addGlassProperties(material) {
    // 加载 sIBL-LA_Downtown_Afternoon_Fishing_3k.hdr 环境贴图
    const rgbeLoader = new RGBELoader();
    rgbeLoader.setDataType(THREE.FloatType);

    rgbeLoader.load(
      "./sIBL-LA_Downtown_Afternoon_Fishing_3k.hdr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        // 为材质设置环境贴图
        material.envMap = texture;
        material.envMapIntensity = 3.2; // 环境贴图强度
        material.needsUpdate = true;

        console.log(
          "已为材质添加 sIBL-LA_Downtown_Afternoon_Fishing_3k.hdr 环境贴图"
        );
      },
      (progress) => {
        if (progress.lengthComputable) {
          console.log(
            "环境贴图加载进度:",
            (progress.loaded / progress.total) * 100 + "%"
          );
        }
      },
      (error) => {
        console.error("环境贴图加载失败:", error);
        // 如果加载失败，使用场景的环境贴图作为备用
        if (this.scene.environment) {
          material.envMap = this.scene.environment;
          material.envMapIntensity = 3.2;
          material.needsUpdate = true;
          console.log("使用场景环境贴图作为备用");
        }
      }
    );
  }

  /**
   * 对单个材质应用/恢复建筑外壳透视（与正常显示切换）
   * @param {THREE.Material} mat
   * @param {boolean} transparent
   */
  _applyBuildingShellMaterial(mat, transparent) {
    if (!mat) return;
    if (!mat.userData._buildingShellOrig) {
      mat.userData._buildingShellOrig = {
        opacity: mat.opacity,
        transparent: mat.transparent,
        depthWrite: mat.depthWrite,
        transmission:
          mat.transmission !== undefined ? mat.transmission : undefined,
      };
    }
    const orig = mat.userData._buildingShellOrig;
    if (transparent) {
      mat.transparent = true;
      mat.opacity = Math.max(0.06, Math.min(0.42, orig.opacity * 0.35));
      mat.depthWrite = false;
      if (orig.transmission !== undefined && mat.transmission !== undefined) {
        mat.transmission = Math.max(0, Math.min(0.22, orig.transmission * 0.18));
      }
    } else {
      mat.opacity = orig.opacity;
      mat.transparent = orig.transparent;
      mat.depthWrite = orig.depthWrite;
      if (orig.transmission !== undefined && mat.transmission !== undefined) {
        mat.transmission = orig.transmission;
      }
    }
    mat.needsUpdate = true;
  }

  /**
   * 设置室内建筑外壳（buildingModel）为透视半透明或恢复正常显示
   * @param {boolean} transparent true 半透明透视，false 恢复加载时的外观
   */
  setBuildingShellTransparent(transparent) {
    if (!this.buildingModel) return;
    this.buildingShellTransparent = !!transparent;
    this.buildingModel.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const list = Array.isArray(child.material)
        ? child.material
        : [child.material];
      list.forEach((mat) =>
        this._applyBuildingShellMaterial(mat, this.buildingShellTransparent)
      );
    });
  }

  /** 在建筑外壳半透明与正常显示之间切换 */
  toggleBuildingShellTransparent() {
    this.setBuildingShellTransparent(!this.buildingShellTransparent);
  }

  /**
   * 为建筑模型添加探照灯光和点光源，模拟玻璃光照效果
   * @param {THREE.Object3D} buildingModel 建筑模型
   */
  addBuildingLighting(buildingModel) {
    if (!buildingModel) return;

    // 计算建筑的包围盒
    const box = new THREE.Box3();
    box.setFromObject(buildingModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // 建筑的高度和半径
    const buildingHeight = size.y;
    const buildingRadius = Math.max(size.x, size.z) / 2;

    // 创建灯光组
    this.buildingLights = new THREE.Group();
    this.buildingLights.name = "buildingLights";

    // 1. 添加探照灯光（从四个角落照射）
    const spotLightPositions = [
      {
        x: center.x - buildingRadius * 2,
        y: center.y + buildingHeight * 0.8,
        z: center.z - buildingRadius * 2,
      },
      {
        x: center.x + buildingRadius * 2,
        y: center.y + buildingHeight * 0.8,
        z: center.z - buildingRadius * 2,
      },
      {
        x: center.x - buildingRadius * 2,
        y: center.y + buildingHeight * 0.8,
        z: center.z + buildingRadius * 2,
      },
      {
        x: center.x + buildingRadius * 2,
        y: center.y + buildingHeight * 0.8,
        z: center.z + buildingRadius * 2,
      },
    ];

    spotLightPositions.forEach((pos, index) => {
      // 创建探照灯
      const spotLight = new THREE.SpotLight(
        0xffffff,
        2.0,
        0,
        Math.PI / 6,
        0.3,
        1
      );
      spotLight.position.set(pos.x, pos.y, pos.z);
      spotLight.target.position.copy(center);
      // 减少阴影使用以避免纹理单元溢出
      spotLight.castShadow = index < 2; // 只让前两个探照灯产生阴影

      // 设置阴影参数（降低分辨率以减少纹理使用）
      if (spotLight.castShadow) {
        spotLight.shadow.mapSize.width = 512;
        spotLight.shadow.mapSize.height = 512;
        spotLight.shadow.camera.near = 1;
        spotLight.shadow.camera.far = 1000;
        spotLight.shadow.camera.fov = 30;
      }

      // 添加到灯光组
      this.buildingLights.add(spotLight);
      this.buildingLights.add(spotLight.target);

      // 创建探照灯辅助器（可选，用于调试）
      // const spotLightHelper = new THREE.SpotLightHelper(spotLight, 0xffffff);
      // this.buildingLights.add(spotLightHelper);

      console.log(`添加探照灯 ${index + 1} 位置:`, pos);
    });

    // 2. 添加点光源（围绕建筑底部）
    const pointLightCount = 8;
    for (let i = 0; i < pointLightCount; i++) {
      const angle = (i / pointLightCount) * Math.PI * 2;
      const radius = buildingRadius * 1.5;

      const pointLight = new THREE.PointLight(0x4a90e2, 1.5, 100, 2);
      pointLight.position.set(
        center.x + Math.cos(angle) * radius,
        center.y + buildingHeight * 0.2,
        center.z + Math.sin(angle) * radius
      );
      // 减少点光源阴影以避免纹理单元溢出
      pointLight.castShadow = i < 4; // 只让前4个点光源产生阴影

      // 设置阴影参数（降低分辨率以减少纹理使用）
      if (pointLight.castShadow) {
        pointLight.shadow.mapSize.width = 256;
        pointLight.shadow.mapSize.height = 256;
        pointLight.shadow.camera.near = 1;
        pointLight.shadow.camera.far = 200;
      }

      this.buildingLights.add(pointLight);

      console.log(`添加点光源 ${i + 1} 角度: ${angle.toFixed(2)}`);
    }

    // 3. 添加顶部聚光灯（从上方照射）
    const topSpotLight = new THREE.SpotLight(
      0xffffff,
      3.0,
      0,
      Math.PI / 4,
      0.2,
      1
    );
    topSpotLight.position.set(
      center.x,
      center.y + buildingHeight * 1.5,
      center.z
    );
    topSpotLight.target.position.copy(center);
    // 顶部聚光灯不产生阴影以避免纹理单元溢出
    topSpotLight.castShadow = false;

    // 设置阴影参数（如果需要阴影，降低分辨率）
    if (topSpotLight.castShadow) {
      topSpotLight.shadow.mapSize.width = 512;
      topSpotLight.shadow.mapSize.height = 512;
      topSpotLight.shadow.camera.near = 1;
      topSpotLight.shadow.camera.far = 1000;
      topSpotLight.shadow.camera.fov = 45;
    }

    this.buildingLights.add(topSpotLight);
    this.buildingLights.add(topSpotLight.target);

    // 创建顶部聚光灯辅助器
    // const topSpotLightHelper = new THREE.SpotLightHelper(
    //   topSpotLight,
    //   0xffffff
    // );
    // this.buildingLights.add(topSpotLightHelper);

    // 4. 添加环境补光（柔和的环境光）
    const ambientFill = new THREE.AmbientLight(0x404040, 0.3);
    this.buildingLights.add(ambientFill);

    // 将灯光组添加到场景
    this.scene.add(this.buildingLights);

    console.log(
      `为建筑模型添加了 ${spotLightPositions.length} 个探照灯、${pointLightCount} 个点光源和 1 个顶部聚光灯`
    );
  }

  /**
   * 处理待设置环境贴图的材质
   */
  processPendingEnvMapMaterials() {
    if (
      this.pendingEnvMapMaterials &&
      this.pendingEnvMapMaterials.length > 0 &&
      this.scene.environment
    ) {
      console.log(
        `处理 ${this.pendingEnvMapMaterials.length} 个待设置环境贴图的材质`
      );
      this.pendingEnvMapMaterials.forEach((material) => {
        material.envMap = this.scene.environment;
        material.envMapIntensity = 2; // 设置微妙的强度
        material.needsUpdate = true;
      });
      this.pendingEnvMapMaterials = [];
    }
  }

  // 建筑材质克隆，用于独立每一栋建筑的材质
  materialClone(child, mList) {
    if (child.isMesh) {
      const name = child.material.name;
      if (!mList[name]) {
        const m = child.material.clone();
        mList[name] = m;
        child.material = m;
      } else {
        child.material = mList[name];
      }

      child.material.originTransparent = child.material.transparent;
    }
  }
  setBuildingBoard(group) {
    // 用于计算旋转中心的建筑
    const { center, max } = getBoxCenter(group);
    const currentPosition = new THREE.Vector3(center.x, max.y, center.z);
    const name = group.name;

    // 根据建筑编号，找到对应的建筑名称，创建建筑标识牌
    const buildingName = name.split("_")[1];
    const buildingTypeName = {
      制冷: "能源站",
      制热: "热水系统",
      配电室: "配电室地下一层",
    };
    const nameLabel = createBuildingNameLabel(
      buildingTypeName[buildingName],
      // 单击：拉近视角
      (css2d) => {
        this.cameraMoveToBuildingTitle(name);
      },
      // 双击：切换进入室内
      (css2d) => {
        this.core.changeSystem("indoorSubsystem", name);
      },
      // 鼠标进入：显示建筑悬停效果
      (css2d) => {
        const position = css2d.position.clone();
        position.y += 5; // 在牌子稍微上方显示

        // 使用封装的方法显示建筑悬停效果
        this.showBuildingHoverEffect(name, position, group);
      },
      // 鼠标离开：隐藏建筑悬停效果
      (css2d) => {
        // 使用封装的方法隐藏建筑悬停效果
        this.hideBuildingHoverEffect();
      }
    );
    nameLabel.visible = true; // 默认显示
    nameLabel.position.copy(currentPosition);
    this.labelGroup.add(nameLabel);
    this.buildingNameLabelMap[name] = nameLabel;

    // 创建建筑信息标识牌，标识牌显示建筑内人员数量信息,人员信息为0时，隐藏该标识牌
    const infoLabel = createBuildingInfoLabel(0, false);
    infoLabel.position.copy(currentPosition);
    infoLabel.scale.set(0.2, 0.2, 0.2);
    infoLabel.name = name;
    this.labelGroup.add(infoLabel);
    this.buildingNum[name] = infoLabel;
  }
  setFilterBuilding(filterArray) {
    // 设置筛选
    this.filterBuildingArr.length = 0;
    this.filterBuildingArr = filterArray;
  }
  filterBuildingNum() {
    const visible = this.filterBuildingArr.includes("buildingBoard");
    Object.values(this.buildingNum).forEach((child) => {
      child.traverse((res) => {
        res.visible = visible;
        res.visible = parseInt(res.element.innerText) > 0 ? visible : false;
      });
    });
  }

  /**
   * 显示建筑悬停效果（提示框、环形圆圈、轮廓高亮）
   * @param {string} buildingName - 建筑名称
   * @param {THREE.Vector3} position - 显示位置
   * @param {THREE.Object3D} [buildingObject] - 建筑对象，用于计算包围盒和轮廓高亮
   */
  showBuildingHoverEffect(buildingName, position, buildingObject = null) {
    // 检查是否可以进入室内
    if (this.buildingNames.some((name) => buildingName.includes(name))) {
      // 显示提示框
      if (this.tooltip) {
        this.tooltip.show(position);
      }

      // 显示环形圆圈效果
      if (this.buildingHoverRings && buildingObject) {
        // 计算建筑的包围盒半径
        const box = new THREE.Box3();
        box.setFromObject(buildingObject);
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z) / 2;

        this.buildingHoverRings.show(position, 1.6);
      }

      // 添加轮廓高亮
      if (buildingObject && this.postprocessing) {
        this.postprocessing.clearOutlineAll(1);
        this.postprocessing.addOutline(buildingObject, 1);
      }
    }
  }

  /**
   * 隐藏建筑悬停效果
   */
  hideBuildingHoverEffect() {
    // 隐藏提示框
    if (this.tooltip) {
      this.tooltip.hide();
    }

    // 隐藏环形圆圈效果
    if (this.buildingHoverRings) {
      this.buildingHoverRings.hide();
    }

    // 如果有搜索的建筑，保持其轮廓高亮
    if (this.searchBuildingId && this.postprocessing) {
      const pickBuilding = this.buildingMeshObj[this.searchBuildingId];
      if (pickBuilding) {
        this.postprocessing.clearOutlineAll(1);
        this.postprocessing.addOutline(pickBuilding, 1);
      }
    } else if (this.postprocessing) {
      this.postprocessing.clearOutlineAll(1);
    }
  }

  cameraMoveToBuildingTitle(id) {
    // 相机移动到建筑牌子
    this.commonSearchBuilding(id);
  }
  commonSearchBuilding(id) {
    console.log(id, "id");
    // this.core.clearSearch(); // 清除现有搜索条件
    this.searchBuildingId = id;
    this.searchBuilding();
    this.removeEventListener();
    this.addEventListener(); // 搜索楼栋的时候可以正常进入建筑内部
  }
  boardClick = (board) => {
    // 检查board是否存在且有position属性
    if (!board || !board.position) {
      console.warn("boardClick: board对象不存在或缺少position属性", board);
      return;
    }

    const offset = new THREE.Vector3(2, 2, 0);
    this.tweenControl.lerpTo(board.position, 20, 1000, offset);
  };

  buildingNumClick(id) {
    postBuildingId(id);
  }

  changeBuildingNumber(array) {
    // 修改建筑数字
    array.map((child) => {
      const { id, number } = child;
      if (!buildingMap[id] || !this.buildingNum[id]) return false;
      this.buildingNum[id].element.innerText = String(number);

      this.buildingNum[id].visible =
        number > 0 && this.filterBuildingArr.includes("buildingBoard");
    });
  }
  showSingleBuildingBoard(id) {
    // 显示单个建筑牌子
    Object.entries(this.buildingNameLabelMap).map(([key, value]) => {
      if (key === id) {
        value.visible = true;
      } else {
        value.visible = false;
      }
    });
  }

  onLeave() {
    // this.weather.resetComposer();
    this.hideAllBuildingLabel(); // 离开时隐藏所有建筑牌子
    this.resetControls();
    this.setCameraState(false);
    this.core.onRenderQueue.delete(fenceSymbol);
    this.core.onRenderQueue.delete("ground"); // 清理渲染队列
    this.measureArea.end();
    this.measureDistance.end();
    this.boxSelect.end();
    this.removeEventListener();
    document.body.style.cursor = "auto";

    // 清理提示框 - 移除重复的 hide() 调用，因为 hideAllBuildingLabel() 已经处理了
    if (this.tooltip) {
      this.tooltip.destroy();
      this.tooltip = null;
    }

    // 隐藏场景提示
    if (this.sceneHint) {
      this.sceneHint.hide();
    }

    // 隐藏环形圆圈效果
    if (this.buildingHoverRings) {
      this.buildingHoverRings.hide();
    }

    // 清理环境贴图资源
    this.clearEnvironment();

    // 清理建筑灯光
    this.clearBuildingLights();

    console.log("离开地面广场系统");
  }
  onLoaded() {
    if (!this.useCameraState) {
      autoRotate(this);
    }

    if (this.roamEnabled) {
      this.setCameraState(true);
    }

    if (this.instancedMesh && this.instancedMesh.length > 0) {
      this.instancedMesh.forEach((mesh) => {
        if (mesh && mesh instanceof THREE.Object3D) {
          this._add(mesh);
        }
      });
    }

    console.log("All models loaded successfully");
    this.addEventListener();
    // ground场景正常流程镜头动画
    changeIndoor("home");
    this.resetCamera(1500, true).then(() => {
      if (this.core && this.core.crossSearch) {
        this.core.crossSearch.changeSceneSearch();
      }
      super.updateOrientation();
    }); // 镜头动画结束后执行事件绑定
  }

  /**
   * 更新工艺和工艺牌子颜色（室外场景）
   * @param {Array} designData - 设计数据数组，包含 {code, name, status}
   */
  updateDesign(designData) {
    if (!Array.isArray(designData)) {
      console.warn("updateDesign 参数格式错误，应为数组");
      return;
    }

    console.log("开始更新室外场景工艺设计，数据:", designData);

    // 遍历场景中的所有对象，查找匹配的设备
    designData.forEach((design) => {
      const { code, name, status } = design;

      if (!code) {
        console.warn("设计数据缺少 code 字段:", design);
        return;
      }

      // 在场景中查找对应的对象
      let foundObject = null;
      this.scene.traverse((object) => {
        // 检查对象名称是否匹配 code
        if (object.name && (object.name === code || object.name.includes(code))) {
          // 进一步检查：如果名称包含 "_shebei"，提取前面的部分进行比较
          if (object.name.includes("_shebei")) {
            const deviceCode = object.name.split("_shebei")[0];
            if (deviceCode === code) {
              foundObject = object;
              return; // 找到后停止遍历
            }
          } else if (object.name === code) {
            foundObject = object;
            return;
          }
        }
      });

      if (foundObject) {
        this.updateGroundSingleDesign(foundObject, name, status, code);
      } else {
        console.warn(`未找到 code 为 ${code} 的工艺模型（室外场景）`);
      }
    });

    console.log("室外场景工艺设计更新完成");
  }

  /**
   * 更新室外场景单个工艺和牌子的颜色
   * @param {THREE.Object3D} deviceObject - 设备对象
   * @param {string} name - 牌子显示的名称
   * @param {string} status - 状态颜色（十六进制字符串）
   * @param {string} code - 工艺代码
   */
  updateGroundSingleDesign(deviceObject, name, status, code) {
    if (!deviceObject) {
      console.warn("设备对象不存在");
      return;
    }

    // 1. 更新工艺模型（deviceObject）的颜色
    this.updateDeviceObjectColor(deviceObject, status);

    // 2. 查找并更新对应的标签（如果存在）
    // 检查 simpleLabel 中是否有对应的标签
    if (this.simpleLabel && this.simpleLabel[code]) {
      const labelInfo = this.simpleLabel[code];
      if (labelInfo.element) {
        this.updateLabelElement(labelInfo.element, name, status);
      }
    } else {
      // 如果没有在 simpleLabel 中找到，尝试在 labelGroup 中查找
      // 注意：这里可能需要根据实际标签结构进行调整
      console.log(`室外场景未找到 code 为 ${code} 的标签，仅更新模型颜色`);
    }

    console.log(`室外场景工艺 ${code} 更新完成: 名称=${name}, 颜色=${status}`);
  }

  /**
   * 更新设备对象（工艺模型）的颜色
   * @param {THREE.Object3D} deviceObject - 设备对象
   * @param {string} colorHex - 颜色值（十六进制字符串，如 '#000000'）
   */
  updateDeviceObjectColor(deviceObject, colorHex) {
    if (!deviceObject) return;

    const color = new THREE.Color(colorHex);

    // 遍历设备对象的所有 mesh，更新材质颜色
    deviceObject.traverse((child) => {
      if (child.isMesh && child.material) {
        // 处理材质数组
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((material) => {
          if (
            material.isMeshStandardMaterial ||
            material.isMeshPhysicalMaterial
          ) {
            // 设置材质的颜色
            material.color.copy(color);
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
   * @param {string} colorHex - 颜色值（十六进制字符串）
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

    // 更新颜色样式
    const rgb = this.hexToRgb(colorHex);
    if (rgb) {
      // 更新背景色和边框色
      element.style.borderColor = colorHex;
      // 更新文本阴影颜色（使用稍亮一点的颜色）
      const brighterColor = this.brightenColor(colorHex, 1.2);
      element.style.textShadow = `0 1px 2px ${brighterColor}`;
    }
  }

  /**
   * 将十六进制颜色转换为 RGB
   * @param {string} hex - 十六进制颜色值
   * @returns {Object|null} {r, g, b} 或 null
   */
  hexToRgb(hex) {
    // 移除 # 号
    const cleanHex = hex.replace("#", "");

    // 处理3位和6位十六进制
    const match =
      cleanHex.length === 3
        ? cleanHex.match(/^([a-f\d])([a-f\d])([a-f\d])$/i)
        : cleanHex.match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);

    if (!match) {
      console.warn(`无效的颜色值: ${hex}`);
      return null;
    }

    return {
      r:
        cleanHex.length === 3
          ? parseInt(match[1] + match[1], 16)
          : parseInt(match[1], 16),
      g:
        cleanHex.length === 3
          ? parseInt(match[2] + match[2], 16)
          : parseInt(match[2], 16),
      b:
        cleanHex.length === 3
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
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;

    const newR = Math.min(255, Math.round(rgb.r * factor));
    const newG = Math.min(255, Math.round(rgb.g * factor));
    const newB = Math.min(255, Math.round(rgb.b * factor));

    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  removeEventListener() {
    this.eventClear.forEach((clear) => clear());
    this.eventClear = [];
  }
  // 动画现在由全局动画管理器统一处理

  /**
   * @param {THREE.Object3D} model
   * @param {()=>void} setAttribute 设置属性
   */
  loadInstancedModel(model, setAttribute, scale) {
    const group = new THREE.Group();

    const instanceMap = {};
    const instancePositionMap = {};
    const instanceRotationMap = {};

    const v = new THREE.Vector3();

    function setInstanceArray(child) {
      child.getWorldPosition(v);

      const key = child.name.split("_")[0];
      instancePositionMap[key] = instancePositionMap[key] || [];
      instancePositionMap[key].push(v.clone());

      // child.getWorldDirection(v);
      instanceRotationMap[key] = instanceRotationMap[key] || [];
      instanceRotationMap[key].push(child.rotation);
    }

    model.forEach((group) => {
      if (group.name.includes("zuobiao")) {
        group.traverse((child) => {
          setInstanceArray(child);
        });
      }
      if (group.name.includes("shili")) {
        group.children.forEach((ins) => {
          instanceMap[ins.name] = ins;
          if (ins.name.includes("shu")) {
            ins.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.material = new THREE.MeshLambertMaterial({
                  map: child.material.map,
                });
                modelProcess(child, "树", this);
              }
            });
          }
        });
      }
    });

    Object.keys(instanceMap).forEach((key) => {
      const instance = instanceMap[key];

      let ins;

      if (key.indexOf("shu") !== -1) {
        ins = createInstanceMesh(
          instance,
          instancePositionMap[key],
          true,
          scale
        );
      } else {
        ins = createInstanceMesh(
          instance,
          instancePositionMap[key],
          instanceRotationMap[key],
          scale
        );
      }

      group.add(ins);
      if (ins instanceof THREE.Group) {
        ins.traverse(setAttribute);
      } else {
        setAttribute(ins);
      }
    });
    return group;
  }
  resetCamera(duration = 1000, fromOnLoaded = false) {
    if (!this.cameraResetModel) {
      console.warn("地面模型未加载，无法重置相机");
      return Promise.resolve();
    }

    const { radius, center } = getBoxCenter(this.cameraResetModel);
    center.y += radius * 0.24;

    const finalCameraPosition = new THREE.Vector3(
      center.x - radius * 1.6,
      center.y + 4,
      center.z - radius * 1
    );
    const controlsTarget = center.clone();

    return new Promise((resolve, reject) => {
      if (
        finalCameraPosition.distanceTo(this.camera.position) < 5 &&
        controlsTarget.distanceTo(this.controls.target) < 5
      )
        resolve();

      this.tweenControl.changeTo({
        start: this.camera.position,
        end: finalCameraPosition,
        duration,
        onComplete: () => {
          this.controls.enabled = true;
          resolve();
        },
        onStart: () => {
          this.controls.enabled = false;
        },
      });

      this.tweenControl.changeTo({
        start: this.controls.target,
        end: controlsTarget,
        duration,
        onUpdate: () => {
          this.camera.lookAt(this.controls.target);
        },
      });
    });
  }
  initLight() {
    // 设置 RoomEnvironment 环境效果
    this.setEnvironment("hdr");

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45); // 线性SRG
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.55);
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 3500;
    directionalLight.shadow.camera.right = 2500;
    directionalLight.shadow.camera.left = -2500;
    directionalLight.shadow.camera.top = 1600;
    directionalLight.shadow.camera.bottom = -1600;
    directionalLight.shadow.mapSize.width = Math.pow(2, 11);
    directionalLight.shadow.mapSize.height = Math.pow(2, 11);
    directionalLight.shadow.blurSamples = 8;

    directionalLight.shadow.radius = 1.15;
    directionalLight.shadow.bias = -0.0015;

    directionalLight.position.set(15, 48, -48);
    directionalLight.castShadow = true;

    // 设置方向光的目标点（场景中心）
    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, 0, 0);
    directionalLight.target = lightTarget;

    this.ambientLight = ambientLight;
    this._add(this.ambientLight);

    this.directionalLight = directionalLight;
    this._add(this.directionalLight);
    this._add(lightTarget);

    // 添加灯光辅助器（调试用）
    const ch = new THREE.CameraHelper(directionalLight.shadow.camera);
    const hp = new THREE.DirectionalLightHelper(directionalLight, 5);
    // this._add(ch);
    // this._add(hp);

    // 创建额外的辅助灯光（可选）
    const dir2 = new THREE.DirectionalLight(0xcccccc, 0.3);
    dir2.position.set(-150, 150, 0);
    // this._add(dir2);

    const dir3 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir3.position.set(150, 100, 0);
    // this._add(dir3);

    console.log("地面系统灯光初始化完成，已设置 RoomEnvironment");
  }
  showAllBuildingLabel() {
    Object.values(this.buildingNameLabelMap).forEach((child) => {
      child.visible = true;
      child.element.style.display = "block";
    });
  }

  /**
   * 子系统执行在动画帧中的函数
   */
  update() {
    // 更新建筑悬停环形圆圈动画
    if (this.buildingHoverRings && this.buildingHoverRings.visible) {
      const deltaTime = this.core.clock ? this.core.clock.getDelta() : 0.016; // 备用时间增量
      this.buildingHoverRings.update(deltaTime);
    }

    // 更新着色器材质的时间uniform
    if (this.glowMaterials) {
      this.glowMaterials.forEach((material) => {
        if (material.uniforms && material.uniforms.iTime) {
          material.uniforms.iTime.value = this.core.clock
            ? this.core.clock.getElapsedTime()
            : 0;
        }
      });
    }
  }

  destroy() {
    // 清理提示框资源
    if (this.tooltip) {
      this.tooltip.destroy();
      this.tooltip = null;
    }

    // 清理场景提示资源
    if (this.sceneHint) {
      this.sceneHint.destroy();
      this.sceneHint = null;
    }

    // 清理环形圆圈资源
    if (this.buildingHoverRings) {
      this.buildingHoverRings.dispose();
      this.scene.remove(this.buildingHoverRings);
      this.buildingHoverRings = null;
    }

    // 清理发光材质资源
    if (this.glowMaterials) {
      this.glowMaterials.forEach((material) => {
        if (material.uniforms) {
          // 清理纹理资源
          if (material.uniforms.uTexture && material.uniforms.uTexture.value) {
            material.uniforms.uTexture.value.dispose();
          }
        }
        material.dispose();
      });
      this.glowMaterials = [];
    }

    // 清理环境贴图资源
    this.clearEnvironment();

    // 清理建筑灯光
    this.clearBuildingLights();
  }

  /**
   * 清理环境贴图资源
   */
  clearEnvironment() {
    if (this.scene.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }
    if (this.scene.background && this.scene.background !== SunnyTexture) {
      this.scene.background.dispose();
      this.scene.background = null;
    }
  }

  /**
   * 清理建筑灯光资源
   */
  clearBuildingLights() {
    if (this.buildingLights) {
      // 遍历灯光组中的所有灯光，清理资源
      this.buildingLights.traverse((child) => {
        if (child.isLight) {
          // 清理阴影贴图
          if (child.shadow && child.shadow.map) {
            child.shadow.map.dispose();
            child.shadow.map = null;
          }
          // 清理灯光
          child.dispose();
        }
      });

      // 从场景中移除灯光组
      this.scene.remove(this.buildingLights);
      this.buildingLights = null;

      console.log("建筑灯光资源已清理");
    }
  }

  /**
   * 切换建筑灯光的显示/隐藏
   * @param {boolean} visible 是否显示灯光
   */
  toggleBuildingLights(visible = true) {
    if (this.buildingLights) {
      this.buildingLights.visible = visible;
      console.log(`建筑灯光已${visible ? "开启" : "关闭"}`);
    }
  }

  /**
   * 调整建筑灯光强度
   * @param {number} intensity 灯光强度倍数 (0.1 - 3.0)
   */
  adjustBuildingLightIntensity(intensity = 1.0) {
    if (this.buildingLights) {
      this.buildingLights.traverse((child) => {
        if (child.isLight) {
          child.intensity *= intensity;
        }
      });
      console.log(`建筑灯光强度已调整为 ${intensity} 倍`);
    }
  }

  /**
   * 优化材质纹理使用，避免纹理单元溢出
   * @param {THREE.Material} material 材质对象
   */
  optimizeMaterialTextures(material) {
    if (!material) return;

    // 移除不必要的纹理属性以减少纹理单元使用
    const textureProperties = [
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "emissiveMap",
      "aoMap",
      "displacementMap",
      "lightMap",
      "envMapIntensity",
    ];

    textureProperties.forEach((prop) => {
      if (material[prop] && !material[prop].isTexture) {
        delete material[prop];
      }
    });

    // 确保只保留必要的纹理
    if (material.map && !material.map.isTexture) {
      delete material.map;
    }

    // 设置材质为不需要更新纹理
    material.needsUpdate = true;
  }

  /**
   * 创建简化的玻璃材质（用于纹理单元溢出时的备用方案）
   * @param {THREE.Material} originalMaterial 原始材质
   */
  createSimpleGlassMaterial(originalMaterial) {
    // 保存原始颜色和透明度
    const originalColor = originalMaterial.color
      ? originalMaterial.color.clone()
      : new THREE.Color(0xffffff);
    const originalOpacity =
      originalMaterial.opacity !== undefined ? originalMaterial.opacity : 1.0;

    // 创建简化的玻璃材质
    const simpleGlassMaterial = new THREE.MeshStandardMaterial({
      color: originalColor,
      opacity: originalOpacity,
      transparent: true,
      metalness: 0.0,
      roughness: 0.1, // 稍微粗糙以模拟玻璃
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });

    // 设置环境贴图（如果场景环境贴图存在）
    if (this.scene.environment) {
      simpleGlassMaterial.envMap = this.scene.environment;
      simpleGlassMaterial.envMapIntensity = 1.0;
    }

    console.log(
      `为材质 ${originalMaterial.name || "bbll"} 创建简化玻璃材质（备用方案）`
    );
    return simpleGlassMaterial;
  }

  /**
   * 设置环境效果
   * @param {string} type - 环境类型: 'room', 'hdr', 'default'
   * @param {Object} options - 配置选项
   */
  setEnvironment(type = "room", options = {}) {
    // 先清理现有环境
    this.clearEnvironment();

    switch (type) {
      case "room":
        // 使用 RoomEnvironment
        const pmremGenerator = new THREE.PMREMGenerator(this.core.renderer);
        this.scene.environment = pmremGenerator.fromScene(
          new RoomEnvironment(),
          0.8
        ).texture;
        this.scene.background = SunnyTexture;
        console.log("已设置 RoomEnvironment");
        break;

      case "hdr":
        // 使用 HDR 环境贴图
        this.setHDRSky();
        break;

      case "default":
        // 使用默认环境
        this.scene.background = SunnyTexture;
        console.log("已设置默认环境");
        break;

      default:
        console.warn(`未知的环境类型: ${type}`);
        break;
    }

    // 更新所有材质的环境贴图
    this.updateAllMaterialsEnvironment();
  }

  /**
   * 更新所有材质的环境贴图
   */
  updateAllMaterialsEnvironment() {
    this.scene.traverse((object) => {
      if (object.isMesh && object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => {
            this.setupMaterialEnvironment(material);
          });
        } else {
          this.setupMaterialEnvironment(object.material);
        }
      }
    });
  }

  /**
   * 设置单个材质的环境贴图
   * @param {THREE.Material} material
   */
  setupMaterialEnvironment(material) {
    if (
      material &&
      (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)
    ) {
      if (this.scene.environment) {
        material.envMap = this.scene.environment;
        material.envMapIntensity = 0.8;
        material.needsUpdate = true;
      }
    }
  }

  /**
   * 设置地面广场天空为 HDR 贴图
   */
  setHDRSky() {
    console.log("开始加载 HDR 天空贴图...");

    const loader = new RGBELoader();
    // 尝试不同的数据类型
    loader.setDataType(THREE.FloatType);

    loader.load(
      "./hdr3.hdr",
      (texture) => {
        console.log("HDR 加载成功:", texture);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.exposure = 2;
        this.scene.background = texture;

        // 创建环境贴图副本，设置微妙的强度
        const envTexture = texture.clone();
        envTexture.intensity = 2; // 设置非常微妙的环境贴图强度
        this.scene.environment = envTexture;

        console.log("天空贴图设置完成");

        // 处理待设置环境贴图的材质
        this.processPendingEnvMapMaterials();
      },
      // 加载进度回调
      (progress) => {
        if (progress.lengthComputable) {
          console.log(
            "HDR 加载进度:",
            (progress.loaded / progress.total) * 100 + "%"
          );
        }
      },
      // 加载错误回调
      (error) => {
        console.error("HDR 加载失败:", error);
        console.log("尝试使用备用方案...");

        // 尝试使用 TextureLoader 加载
        this.setFallbackSky();
      }
    );
  }

  /**
   * 备用天空设置方案
   */
  setFallbackSky() {
    try {
      // 尝试使用普通的 TextureLoader 加载
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        "./sunny2.hdr",
        (texture) => {
          console.log("备用方案加载成功");
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.exposure = 0.2;
          this.scene.background = texture;

          // 创建环境贴图副本，设置微妙的强度
          const envTexture = texture.clone();
          envTexture.intensity = 0.02; // 设置非常微妙的环境贴图强度
          this.scene.environment = texture;
        },
        undefined,
        (error) => {
          console.error("备用方案也失败:", error);
          // 最后使用默认的天空颜色
          this.scene.background = new THREE.Color(0x87ceeb);
          console.log("使用默认天空蓝色");
        }
      );
    } catch (error) {
      console.error("备用方案初始化失败:", error);
      // 使用默认的天空颜色
      this.scene.background = new THREE.Color(0x87ceeb);
      console.log("使用默认天空蓝色");
    }
  }
}
