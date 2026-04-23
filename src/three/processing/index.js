import * as THREE from "three";
import {
  fresnel,
  edgeFadeDis,
  edgeFadeUV,
  brighten,
  brightenNight,
  fadeByTime,
  dynamicFade,
  treeModify,
  pathFlow,
  sci_brighten,
  sci_colorModify,
  sci_outerLand,
  sci_playground
} from "../../shader";

import { commonProcess } from "./modelProcess";



export function modelProcess(mesh,modelName,system) {
  if (mesh.isMesh) {

    process(mesh,modelName,system);
    commonProcess(mesh,system,modelName);
  }
}




function process(mesh,modelName,system) {
  const material = mesh.material;

  if (modelName === "其他模型") {
    if (mesh.name.includes('地块区域建筑3_32')) {

      // 企业牌子
      sci_brighten(mesh.material,10);
    }



  }
  if (modelName === "杂项") {
    if (material.name === "车流线") {

      mesh.material.transparent = true;
      pathFlow(mesh.material);
      system.postprocessing.addBloom(mesh);
    }

    if (material.name === "球场灯带") {
      sci_brighten(mesh.material);
      system.postprocessing.addBloom(mesh);
    }
    if (material.name === "生活区标识灯") {
      sci_brighten(mesh.material,10);
    }
    if (material.name === "造型灯-白色") {
      sci_brighten(mesh.material,10);
    }

  }


  if (modelName === "外地形") {
    // mesh.material.name += "边缘虚化";
    material.transparent = true;

    if (["外场景地面_9"].includes(mesh.name)) {
      // 铁轨地面
      sci_outerLand(mesh.material,new THREE.Color("#00010F"));
    }

    if (["外场景地面_4"].includes(mesh.name)) {
      // 铁轨地面
      sci_outerLand(mesh.material,new THREE.Color("#020418"));
    }
    if (["外场景地面_5"].includes(mesh.name)) {
      // 铁轨轨道
      sci_outerLand(mesh.material,new THREE.Color("#1B56C7"));
    }
    if (["外场景地面_6","外场景地面_7","外场景地面_8"].includes(mesh.name)) {
      // 马路
      sci_outerLand(mesh.material,new THREE.Color("#000E12"));
    }
    if (["外场景地面_3","外场景地面_2","外场景地面_1"].includes(mesh.name)) {
      // 水泥区域
      sci_outerLand(mesh.material,new THREE.Color("#04142E"));
    }
  }

  if (modelName === "内地形") {


    if (mesh.name.includes('内部地面绿化')) {
      if (mesh.name.includes("_2")) {

        // 花圃道路踢脚线
        sci_colorModify(mesh.material,new THREE.Color("#86E0E3"));
      } else if (mesh.name.includes("_4")) {
        //水池
        sci_colorModify(mesh.material,new THREE.Color("#43a0e8"));

      } else if (mesh.name.includes("_5")) {
        //鹅卵石路
        sci_colorModify(mesh.material,new THREE.Color("#030d2e"));
      } else if (mesh.name.includes("_6")) {
        //水池边缘
        sci_colorModify(mesh.material,new THREE.Color("#030d2e"));
      } else {

        sci_colorModify(mesh.material,new THREE.Color("#0C1F12"));
      }
    }

    if (mesh.name.includes("主道路")) {
      if (["主道路_1","主道路_6","主道路_2","主道路_5","主道路_9"].includes(mesh.name)) {
        // 主要道路
        sci_colorModify(mesh.material,new THREE.Color("#000E12"));

      }
      if (["主道路_8"].includes(mesh.name)) {
        // 道路斑马线
        sci_brighten(mesh.material,0.5);

      }

    }



    if (mesh.name.includes("道路标线")) {

      // 停车场斑马线
      sci_brighten(mesh.material,10);

    }
    if (["地面_13"].includes(mesh.name)) {
      // 足球场
      sci_playground(mesh.material);

    }
    if (["地面_14","地面_15"].includes(mesh.name)) {
      // 篮球场
      sci_playground(mesh.material,3);

    }
    if (["地面_1"].includes(mesh.name)) {
      // 内地行水泥地
      sci_colorModify(mesh.material,new THREE.Color("#0D1A21"));

    }
    if (["地面_11","地面_2"].includes(mesh.name)) {
      // 内地行小范围水泥地
      sci_colorModify(mesh.material,new THREE.Color("#020627"));
      new THREE.Color("#04142E");
    }
    if (["地面_4","地面_17"].includes(mesh.name)) {
      // 办公区域地面
      sci_colorModify(mesh.material,new THREE.Color("#04142E"));
    }
    if (["地面_23"].includes(mesh.name)) {
      // 办公区域斑马线
      sci_brighten(mesh.material,10);
    }
    if (["地面_20"].includes(mesh.name)) {
      // 铁轨地面
      sci_colorModify(mesh.material,new THREE.Color("#020418"));
    }
    if (["地面_19"].includes(mesh.name)) {
      // 铁轨轨道
      sci_colorModify(mesh.material,new THREE.Color("#1B56C7"));
    }
    if (["地面_21"].includes(mesh.name)) {
      // 球场外草地
      sci_colorModify(mesh.material,new THREE.Color("#0C1F12"));
    }
    if (["地面_12"].includes(mesh.name)) {
      // 球场外红色地面
      sci_colorModify(mesh.material,new THREE.Color("#630402"));
      // sci_colorModify(mesh.material,new THREE.Color("#7f1a2f"));
    }
    if (["地面_6"].includes(mesh.name)) {
      // 办公大楼前地砖
      sci_colorModify(mesh.material,new THREE.Color("#0c2c96"));
    }
    if (["地面_5"].includes(mesh.name)) {
      // 办公大楼前黄色地砖
      sci_colorModify(mesh.material,new THREE.Color("#030d2e"));
    }
    if (["地面_16"].includes(mesh.name)) {
      // 足球场绿网
      sci_colorModify(mesh.material,new THREE.Color("#2de84c"));
    }
  }

  if (modelName === "杂项") {

    if (mesh.name === "道路名称") {

      sci_brighten(mesh.material,20);
    }
  }

  if (modelName === "树") {
    if (["shu3_2","shu4_2"].includes(mesh.name)) {
      treeModify(mesh.material,);


    } else if (mesh.name.includes('_1')) {
      treeModify(mesh.material,);
    }

  }



}
