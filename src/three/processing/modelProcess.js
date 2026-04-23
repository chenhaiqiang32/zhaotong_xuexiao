

import {
  MeshStandardMaterial,
  AnimationMixer,
  TextureLoader,
  RepeatWrapping,
  Vector3,
  Box3
} from "three";
import { Lake } from "../../lib/blMeshes";
import { Subsystem } from "../subsystem";
import {
  water2Material,
  waterSurfaceMaterial,
  updateWaterSurfaceEnvFromScene,
} from "../../shader/material";
import {
  edgeFadeDis,
  brighten,
  brightenNight,
  glassEffect,
} from "../../shader";
import { Store3D } from "..";



/**
 * 获得字符串上的参数值
 * @param {string} string
 * @param {string} key
 * @returns {number|undefined}
 */
function getOptionValue(string,key) {
  const start = string.indexOf(key);
  if (start !== -1) {
    let end = string.indexOf("&",start + key.length);
    if (end === -1) {
      end = string.length;
    }
    let value = string.substring(start + key.length,end);
    if (value.indexOf("0x") !== -1 || value.indexOf("0X") !== -1) {
      value = parseInt(value,16);
    } else {
      value = parseFloat(value);
    }
    return value;
  }
}


function setNormalMap(material,scale = 0.5) {
  const texture = new TextureLoader().load("./textures/water_normal.jpg");
  texture.wrapS = texture.wrapT = RepeatWrapping;
  material.normalMap = texture;
  material.normalScale.set(scale,scale);
}

/**
 * 处理相机漫游模型。仅针对管控项目。
 * @param {import("three/examples/jsm/loaders/GLTFLoader").GLTF} gltf
 */
function processingCameraAnimation(system,gltf) {

  const wanderCamera = gltf.cameras[0];
  const model = gltf.scene;

  const baseCamera = system.baseCamera;
  const renderQueue = system.onRenderQueue || system.core.onRenderQueue;

  // 设置漫游相机属性为系统相机属性

  const { fov,aspect,near,far } = system.camera;
  wanderCamera.fov = fov;
  wanderCamera.aspect = aspect;
  wanderCamera.near = near;
  wanderCamera.far = far;
  wanderCamera.updateProjectionMatrix();

  const target = model.children[0].position;

  const cameraMixer = new AnimationMixer(model);
  const cameraAction = cameraMixer.clipAction(gltf.animations[0]);
  const uuid = wanderCamera.uuid;

  let timer;

  /**动画帧更新函数 */
  function update(param) {
    if (!cameraAction.paused) {
      cameraMixer.update(param.delta);
      wanderCamera.lookAt(target);
      wanderCamera.updateWorldMatrix();
    }
  }

  /**切换相机状态 */
  function updateCameraState() {
    clearTimeout(timer);
    // 如果当前相机为漫游相机
    if (baseCamera !== system.core.camera) {
      cameraAction.paused = true;
      system.core.camera = baseCamera;
      system.postprocessing.composer.setMainCamera(system.core.camera);
    }
    timer = setTimeout(() => {
      system.core.camera = wanderCamera;
      cameraAction.play();
      cameraAction.paused = false;
      system.postprocessing.composer.setMainCamera(system.core.camera);
    },system.roamDuration * 1000);
  }
  /**开始事件，加入渲染队列 */
  function begin() {
    system.core.domElement.addEventListener("mousemove",updateCameraState);
    renderQueue.set(uuid,update);
  }
  /**移除事件，从渲染队列移除 */
  function stop() {
    system.core.domElement.removeEventListener("mousemove",updateCameraState);
    renderQueue.delete(uuid);
    clearTimeout(timer);
  }

  const useCameraState = () => {
    return { begin,updateCameraState,stop };
  };

  system.useCameraState = useCameraState;

  return useCameraState;
}


/**
 *
 * @param {Subsystem} system
 * @returns
 */
function autoRotate(system) {

  const core = system.core;
  const camera = core.camera;
  const controls = core.controls;

  let timer;

  /**切换相机状态 */
  function updateCameraState() {

    clearTimeout(timer);

    controls.autoRotate = false;
    controls.rotateSpeed = 1;

    timer = setTimeout(() => {

      controls.target.copy(Store3D.Default.target);
      camera.position.copy(Store3D.Default.position);

      controls.autoRotate = true;
      controls.rotateSpeed = 0.01;

    },system.roamDuration * 1000);
  }
  /**开始事件，加入渲染队列 */
  function begin() {
    system.core.domElement.addEventListener("mousemove",updateCameraState);

  }
  /**移除事件，从渲染队列移除 */
  function stop() {
    system.core.domElement.removeEventListener("mousemove",updateCameraState);
    clearTimeout(timer);
  }

  const useCameraState = () => {
    return { begin,updateCameraState,stop };
  };

  system.useCameraState = useCameraState;

  return useCameraState;
}


const water2 = water2Material();
const waterSurface = waterSurfaceMaterial();

/**
 * 处理通用模型
 * @param {import("three/examples/jsm/loaders/GLTFLoader").GLTF} gltf
 * @param {Subsystem} system 系统环境
 */


function commonProcess(child,system,modelName) {

  const renderQueue = system.onRenderQueue || system.core.onRenderQueue;

  /**@type {MeshStandardMaterial} */
  const material = child.material;


  if (material.name.includes("镜面水")) {

    child.visible = false;

    const box = new Box3();
    box.setFromObject(child);

    // 传入child可以生成任意多边形湖面
    const lake = new Lake(box,100,100);
    const mesh = lake.mesh;

    child.getWorldPosition(mesh.position);

    // mesh.position.copy(child.position);

    // 欧拉角旋转
    mesh.rotation.z = child.rotation.y;

    renderQueue.set(Symbol(),lake.update.bind(lake));
    system.add(mesh);
  } else if (modelName === "内地形" && material.name === "JD-101") {
    child.material = waterSurface;
    child.onBeforeRender = (renderer, scene, camera) => {
      waterSurface.uniforms.uCameraWorld.value.copy(camera.position);
      updateWaterSurfaceEnvFromScene(waterSurface, scene);
    };
  } else if (material.name.includes("水")) {
    child.material = water2;
  }

  if (material.name.includes("漆面")) {
    material.roughness = 0.5;
    material.metalness = 0.5;
    setNormalMap(material,0.1);
  }

  if (material.name.includes("夜光玻璃")) {
    material.transparent = true;
    glassEffect(material);
  } else if (material.name.includes("夜光")) {
    brightenNight(material,20);
  } else if (material.name.includes("发光")) {
    brighten(material,10);
    child.castShadow = false;
    system.bloomLights.push(child);
  }

  if (material.name.includes("边缘虚化")) {
    material.transparent = true;
    edgeFadeDis(material,1600,2800);
  }

  material.needsUpdate = true;
}


export {
  processingCameraAnimation,
  setNormalMap,
  commonProcess,
  autoRotate
};
