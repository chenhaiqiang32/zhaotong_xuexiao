import { GridHelper,AxesHelper } from "three";
import { SubScene } from "../../three/scene/SubScene";

/**@classdesc 子系统 */
export class Subsystem {

  /**
   * @param {import('../index').Store3D} core
   */
  constructor(core) {
    this.core = core;
    this.scene = new SubScene();
  }

  /**子系统初始化 */
  init() { }

  /**进入子系统执行的回调函数 */
  onEnter() { }

  /**离开子系统执行的回调函数 */
  onLeave() { }

  /**子系统模型加载完成执行的回调函数 */
  onLoaded() { }

  /**子系统执行在动画帧中函数 */
  update() { }

  updateOrientation() {
    this.core.orientation.updateModules();
  }

  /**子系统添加事件监听 */
  addEventListener() { }

  /**子系统移除事件监听 */
  removeEventListener() { }

  /**切换子系统灯光（前提是子系统调用了天气模块） */
  changeWeather() {
    console.log("当前子系统未调用天气模块");
  }

  /**切换子系统灯光（前提是子系统调用了天气模块） */
  changeLighting() {
    console.log("当前子系统未调用天气模块");
  }

  /**设置子系统相机漫游状态 */
  setCameraState() {
    console.log("当前子系统没有相机漫游功能");
  }

  /**开启子系统第一人称漫游 */
  beginWander() {
    console.log("当前子系统没有第一人称漫游功能");
  }

  /**关闭子系统第一人称漫游 */
  endWander() {
    console.log("当前子系统没有第一人称漫游功能");
  }

  initGridHelper(num = 100) {
    const gridHelper = new GridHelper(num);
    this.scene.add(gridHelper);
  }
  initAxesHelper(num = 100) {
    const axesHelper = new AxesHelper(num);
    this.scene.add(axesHelper);
  }

  add() {
    this.scene.add(...arguments);
  }

  _add() {
    this.scene._add(...arguments);
  }

  dispose() {
    this.scene.dispose();
  }
}
