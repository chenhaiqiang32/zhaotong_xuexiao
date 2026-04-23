import * as THREE from "three";
import { getCurrentPosition } from "./personCommon";
import { Orientation3D } from "./Orientation3D";
import { Cluster } from "./Cluster";
import { BoxSelect } from "./BoxSelect";
import { PersonFilter } from "./PersonFilter";
import { closeDialog, postPersonBoard } from "../../../message/postMessage";
import { HeatmapSystem } from "./Heatmap";
import { Search } from "./Search";

export const typeName = {
  0: "externalPerson",
  1: "insidePerson",
  2: "laborPerson",
  externalPerson: 0,
  insidePerson: 1,
  laborPerson: 2,
}; // 0 外来人员，1 内部员工，2 劳务派遣

/**
 * 人员定位系统功能核心模块
 * @template {{originId:string,coordinate:{x:number,y:number,z:number},sceneType:0|1,name:string,type:string,id:string}} T1
 * @template {{originId:string,coordinate:{x:number,y:number,z:number},sceneType:0|1,name:string,type:string,id:string,buildingId:string,position:THREE.Vector3,object3d:THREE.Object3D}} T2
 */
export class Orientation {
  static SCENE_TYPE = {
    INDOOR: 0,
    OUTDOOR: 1,
  };

  get searchId() {
    return this.personSearchModule.id;
  }

  set searchId(id) {
    if (!this.has(id)) return;
    this.personSearchModule.id = id;
  }

  /**
   * @param {import('../../index').Store3D} core
   */
  constructor(core) {
    this.core = core;

    /**
     * @type {Map<string,T2>}
     */
    this.map = new Map();

    /**数据更新时,调用功能需要更新的所有更新函数 */
    this.updateMap = new Map();
    this.updatable = [];

    this.sceneData = {
      [Orientation.SCENE_TYPE.INDOOR]: {},
      [Orientation.SCENE_TYPE.OUTDOOR]: [],
    };

    /** 人员聚合模块 */
    this.clusterModule = new Cluster(this);

    /** 人员框选模块 */
    this.boxSelect = new BoxSelect(this);

    /** 人员搜索模块 */
    this.personSearchModule = new Search(this);

    /** 人员跟踪模块 */

    /** 人员筛选模块 */
    this.personFilter = new PersonFilter(this);

    /** 视图更新模块 */
    this.orientation3D = new Orientation3D(this);

    /** 热力图模块 */
    this.heatmapModule = new HeatmapSystem(this);
  }

  /**
   * @description 推送数据更新,增量
   * @param {{add:T1[],remove:T1[],update:T1[]}} data
   */
  init(data) {
    const { add, remove, update } = data;

    add.forEach((child) => this.#add(child));
    remove.forEach((child) => this.#remove(child));
    update.forEach((child) => this.#update(child));

    this.getBuildingDataCount();

    this.updateModules();
  }

  /** 获取每栋建筑的人数 */
  getBuildingDataCount() {
    const result = {};

    const buildingData = this.sceneData[Orientation.SCENE_TYPE.INDOOR];

    const buildingIds = Reflect.ownKeys(buildingData);

    buildingIds.forEach((buildingId) => {
      let count = 0;
      const building = buildingData[buildingId];

      const floorIds = Reflect.ownKeys(building);

      floorIds.forEach((floorId) => {
        const floorData = building[floorId];
        count += floorData.length;
      });

      result[buildingId] = count;
    });
  }

  /**
   * 设置id数据
   * @param {string} id
   * @param {T2} value
   */
  #set(id, value) {
    this.map.set(id, value);
  }

  /**是否存在id数据 */
  has(id) {
    return this.map.has(id);
  }

  /** 获取id数据 */
  get(id) {
    return this.map.get(id);
  }

  /**删除id数据 */
  #del(id) {
    this.map.delete(id);
  }

  /**
   * @param {T1} item
   */
  #add(item, sceneChanged) {
    this.#process(item, sceneChanged);

    this.#set(item.id, item);

    if (item.sceneType === Orientation.SCENE_TYPE.INDOOR) {
      const indoorObj = this.sceneData[Orientation.SCENE_TYPE.INDOOR];

      let buildingId;
      if (item.originId.indexOf("F") !== -1) {
        buildingId = item.originId.slice(0, -3);
      } else {
        buildingId = item.originId;
      }

      if (!indoorObj[buildingId]) indoorObj[buildingId] = {};

      if (!indoorObj[buildingId][item.originId])
        indoorObj[buildingId][item.originId] = [];

      indoorObj[buildingId][item.originId].push(item);
    } else {
      this.sceneData[item.sceneType].push(item);
    }

    if (item.id === this.followId) item.isSingle = true;

    if (item.id === this.searchId) item.isSingle = true;

    this.orientation3D.add(item);
  }

  /**
   * 更新数据
   * @param {T1} item
   */
  #update(item) {
    const oldData = this.get(item.id);
    if (!oldData) return;

    const sceneChanged = oldData.originId != item.originId;

    this.#removeItem(oldData);
    this.#add(item, sceneChanged);
    this.orientation3D.updateData(item);
  }

  /**
   * @param rules
   */
  filterByRule(rules) {
    this.personFilter.filter(rules);

    this.clearSearch();

    this.updateModules();
  }

  #remove(child) {
    if (!this.has(child.id)) return;

    let id = child.id;
    if (this.searchId === id) {
      this.clearSearch(id);
      closeDialog(id); // 通知前端关闭弹窗
    }
    if (this.followId === id) this.cancelFollow(id);
    this.#removeItem(child);
  }
  /**
   * @param {T2} item
   */
  #removeItem(item) {
    this.orientation3D.delete(item);

    this.#del(item.id);

    const { sceneType, originId } = item;

    // 获取当前场景数据
    let currentSceneData = this.getCurrentSceneData(sceneType, originId);

    // 从当前场景数据中删除当前数据
    for (let i = 0; i < currentSceneData.length; i++) {
      if (item.id === currentSceneData[i].id) {
        currentSceneData.splice(i, 1);
        break;
      }
    }
  }

  /**
   * @param {T1} item
   */
  #process(item, sceneChanged) {
    const { coordinate, sceneType, type, originId } = item;
    item.position = getCurrentPosition(
      { coordinate, originId, sceneType },
      true
    );
    item.buildingId = originId.slice(0, -3);
    item.typeName = typeName[type];
    item.object3d = this.orientation3D.create(item, sceneChanged);
  }

  /**
   * 根据场景编号，楼层编号获取当前场景数据
   * @param {0|1} sceneType 场景类型，0室内，1室外
   * @param {originId} buildingId 楼层编号
   * @returns {T2[]}
   */
  getCurrentSceneData(sceneType, originId = "") {
    if (!sceneType && !originId) {
      const info = this.core.getCurrentOriginId();
      sceneType = info.sceneType;
      originId = info.originId;
    }

    if (sceneType === Orientation.SCENE_TYPE.OUTDOOR) {
      return this.sceneData[sceneType];
    } else {
      let buildingId;
      if (originId.indexOf("F") !== -1) {
        buildingId = originId.slice(0, -3);
      } else {
        buildingId = originId;
      }

      const building = this.sceneData[sceneType][buildingId];

      if (!building) return [];

      return building[originId] || [];
    }
  }

  /** 设置搜索 id */
  setSearchId(id) {
    this.searchId = id;
    postPersonBoard(id);
  }

  /** 设置跟踪 id */
  setFollowId(id) {
    this.followId = id;
  }

  /** 搜索人员 */
  search() {
    this.personSearchModule.search();
  }

  /** 取消搜索 */
  clearSearch() {
    // 这个地方不能通知前端关闭弹窗,前端触发的前端会自己关
    this.personSearchModule.clearSearch();
  }

  setHeatmap(bool) {
    if (bool) this.heatmapModule.openHeatmap();
    else this.heatmapModule.clearHeatmap();
  }

  /** 添加监听更新对象 */
  addUpdatable(updatable) {
    if (this.updatable.indexOf(updatable) === -1) {
      this.updatable.push(updatable);
    }
  }

  /** 移除监听更新对象 */
  removeUpdatable(updatable) {
    const index = this.updatable.indexOf(updatable);
    if (index !== -1) this.updatable.splice(index, 1);
  }

  /** 事件派发 */
  updateModules() {
    this.updatable.sort((a, b) => a.order - b.order);
    this.updatable.forEach((m) => m.update(this));
  }
}
