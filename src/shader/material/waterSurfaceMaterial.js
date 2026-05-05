import * as THREE from "three";

import {
  DAY,
  NIGHT,
  lightingPattern,
  elapsedTime,
  SHADER_END,
  SHADER_UNIFORM,
} from "../parameters";

/**
 * 贴地水面：清澈浅青 + 法线微扰 + 强菲涅尔 + 环境/天空反射
 */
export function waterSurfaceMaterial() {
  const normalSampler = new THREE.TextureLoader().load("./textures/water_normal.jpg");
  normalSampler.wrapS = normalSampler.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.ShaderMaterial({
    name: "WaterSurfaceTerrain",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: { USE_ENV_FALLBACK: 1 },
    vertexShader: waterSurfaceVertex,
    fragmentShader: waterSurfaceFragment,
    uniforms: {
      uTime: elapsedTime,
      uStyle: lightingPattern,
      normalSampler: { value: normalSampler },
      uCameraWorld: { value: new THREE.Vector3() },
      sunDirection: { value: new THREE.Vector3(0.45, 0.88, 0.28).normalize() },
      sunColor: { value: new THREE.Color(0xffffff) },
      /** 清澈：浅水极亮、深水仍偏亮青绿，避免浑浊 */
      waterShallow: { value: new THREE.Color(0x2f7dff) },
      waterDeep: { value: new THREE.Color(0x02102a) },
      skyFresnel: { value: new THREE.Color(0x9fd9ff) },
      envMapCube: { value: null },
      envMap2D: { value: null },
      envIntensity: { value: 1.3 },
      envReflectMix: { value: 0.92 },
      /** 垂直视角下仍带一点天光，更像通透水面 */
      envBaseLift: { value: 0.26 },
      /** 越小波纹越大（世界坐标乘数） */
      size: { value: 0.92 },
      distortionScale: { value: 0.48 },
      alpha: { value: 0.68 },
      /** Shadertoy 风格 Voronoi 水面：世界尺度与混入强度 */
      /** 越小 Voronoi 斑块越大 */
      voronoiScale: { value: 0.055 },
      voronoiBlend: { value: 0.18 },
      voronoiBg: { value: new THREE.Vector3(0.02, 0.06, 0.22) },
      /** 波光粼粼闪点强度 */
      sparkleIntensity: { value: 0.95 },
      /** 闪点尺度（越大越细碎） */
      sparkleScale: { value: 3.6 },
    },
  });
  mat.userData.envMode = "fallback";
  return mat;
}

/**
 * 按当前场景背景/环境更新水面反射模式（需在每帧或场景变化时调用）
 * 优先 scene.background 纹理（与天空一致），否则 PMREM 立方体 env
 * @param {THREE.ShaderMaterial} material
 * @param {THREE.Scene} scene
 */
export function updateWaterSurfaceEnvFromScene(material, scene) {
  if (!material?.uniforms) return;
  const bg = scene.background;
  const env = scene.environment;

  let nextMode = "fallback";
  let tex2D = null;
  let texCube = null;

  if (bg && bg.isTexture && !bg.isCubeTexture) {
    nextMode = "equirect";
    tex2D = bg;
  } else if (env && env.isCubeTexture) {
    nextMode = "cube";
    texCube = env;
  } else if (env && env.isTexture && !env.isCubeTexture) {
    nextMode = "equirect";
    tex2D = env;
  }

  if (material.userData.envMode !== nextMode) {
    material.userData.envMode = nextMode;
    material.defines = {};
    if (nextMode === "cube") {
      material.defines.USE_CUBE_ENV = 1;
      material.uniforms.envMapCube.value = texCube;
    } else if (nextMode === "equirect") {
      material.defines.USE_EQUIRECT_ENV = 1;
      material.uniforms.envMap2D.value = tex2D;
    } else {
      material.defines.USE_ENV_FALLBACK = 1;
    }
    material.needsUpdate = true;
  } else {
    if (nextMode === "cube" && texCube) {
      material.uniforms.envMapCube.value = texCube;
    }
    if (nextMode === "equirect" && tex2D) {
      material.uniforms.envMap2D.value = tex2D;
    }
  }
}

const waterSurfaceVertex = `
#include <logdepthbuf_pars_vertex>
#include <common>
${SHADER_UNIFORM}
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  #include <begin_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPosition = wp.xyz;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

  #include <project_vertex>
  #include <logdepthbuf_vertex>
}
`;

const waterSurfaceFragment = `
${SHADER_UNIFORM}
uniform sampler2D normalSampler;
#ifdef USE_CUBE_ENV
uniform samplerCube envMapCube;
#endif
#ifdef USE_EQUIRECT_ENV
uniform sampler2D envMap2D;
#endif
uniform vec3 uCameraWorld;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform vec3 waterShallow;
uniform vec3 waterDeep;
uniform vec3 skyFresnel;
uniform float uTime;
uniform float uStyle;
uniform float size;
uniform float distortionScale;
uniform float alpha;
uniform float envIntensity;
uniform float envReflectMix;
uniform float envBaseLift;
uniform float voronoiScale;
uniform float voronoiBlend;
uniform vec3 voronoiBg;
uniform float sparkleIntensity;
uniform float sparkleScale;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

#define DAY_V ${DAY}.0
#define NIGHT_V ${NIGHT}.0
#define RECIPROCAL_PI2 0.15915494309189535
#define RECIPROCAL_PI 0.3183098861837907
#define S smoothstep

vec2 Hash22(vec2 p) {
  vec3 a = fract(p.xyx * vec3(129.23, 348.45, 677.78));
  a += dot(a, a + vec3(-87.65));
  return fract(vec2(a.x * a.y, a.y * a.z));
}

float voronoiWater(vec2 worldXZ, float iTime) {
  vec2 uv = worldXZ * voronoiScale;
  float time = iTime * 0.5;
  uv *= 3.0;
  uv.y += sin((125.45 + time) * 0.2) + sin(0.5 * (uv.x + time));
  vec2 id = floor(uv);
  vec2 gv = fract(uv) - 0.5;
  float minDist = 1000.0;
  for (int i = 0; i < 9; i++) {
    float dx = mod(float(i), 3.0) - 1.0;
    float dy = floor(float(i) / 3.0) - 1.0;
    vec2 offset = vec2(dx, dy);
    vec2 h = Hash22(id + offset);
    vec2 p = offset + sin(h * (time + 125.87)) * 0.5;
    p -= gv;
    float d = length(p);
    minDist = min(minDist, d);
  }
  float a = sin(iTime * 0.05235);
  a = abs(a) * 0.5;
  a *= 0.1;
  float b = sin(iTime * 0.1235);
  b = abs(b) * 0.5 + 0.5;
  b *= 3.0;
  return S(a, b, minDist * minDist);
}

vec2 equirectUv(vec3 dir) {
  vec3 d = normalize(dir);
  vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
  uv.y = 1.0 - uv.y;
  return uv;
}

vec3 sampleEnvReflect(vec3 R) {
#ifdef USE_CUBE_ENV
  return textureCube(envMapCube, R).rgb;
#elif defined(USE_EQUIRECT_ENV)
  return texture2D(envMap2D, equirectUv(R)).rgb;
#else
  return skyFresnel.rgb;
#endif
}

vec4 getNoise(vec2 uv) {
  float time = uTime;
  vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0);
  vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);
  vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0);
  vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0);
  vec4 noise = texture2D(normalSampler, uv0)
    + texture2D(normalSampler, uv1)
    + texture2D(normalSampler, uv2)
    + texture2D(normalSampler, uv3);
  return noise * 0.5 - 1.0;
}

void sunLight(vec3 surfaceNormal, vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor) {
  vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));
  float direction = max(0.0, dot(eyeDirection, reflection));
  specularColor += pow(direction, shiny) * sunColor * spec;
  diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;
}

#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>

  vec4 noise = getNoise(vWorldPosition.xz * size);
  vec3 surfaceNormal = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));
  surfaceNormal = normalize(vWorldNormal + surfaceNormal * distortionScale * 0.35);

  vec3 worldToEye = uCameraWorld - vWorldPosition;
  vec3 eyeDirection = normalize(worldToEye);
  float dist = max(length(worldToEye), 1.0);

  vec3 diffuseLight = vec3(0.0);
  vec3 specularLight = vec3(0.0);
  sunLight(surfaceNormal, eyeDirection, 128.0, 3.2, 0.38, diffuseLight, specularLight);

  float NdotV = max(dot(eyeDirection, surfaceNormal), 0.001);
  // 清澈水面：掠射菲涅尔更陡，俯视更透
  float fresnel = pow(1.0 - NdotV, 5.2);
  float facing = NdotV;
  vec3 base = mix(waterDeep, waterShallow, 0.42 + 0.55 * facing);
  base = mix(base, vec3(0.94, 0.98, 1.0), 0.22);

  vec3 body;
#ifndef USE_ENV_FALLBACK
  vec3 R = reflect(-eyeDirection, surfaceNormal);
  vec3 envCol = sampleEnvReflect(R);
  float envBlend = fresnel * envReflectMix * envIntensity;
  envBlend = clamp(envBlend + envBaseLift * (0.35 + 0.65 * facing), 0.0, 1.0);
  body = mix(base, envCol, envBlend);
  body += envCol * 0.06 * envIntensity;
#else
  float skyMix = clamp(fresnel * 0.82 + envBaseLift * (0.2 + 0.5 * facing), 0.0, 1.0);
  body = mix(base, skyFresnel, skyMix);
#endif

  vec3 sunTint = vec3(0.55, 0.88, 0.96);
  body += diffuseLight * sunTint * 0.22;
  body += specularLight * vec3(1.0, 1.0, 1.0) * 1.35;

  // 波光粼粼：用更高频的噪声 + 菲涅尔/高光门控生成闪点
  vec4 n2 = getNoise(vWorldPosition.xz * (size * sparkleScale) + vec2(uTime * 0.9, -uTime * 0.7));
  float sparkle = pow(clamp(n2.x * 0.5 + 0.5, 0.0, 1.0), 10.0);
  sparkle *= pow(fresnel, 0.6) * (0.35 + 0.65 * clamp(specularLight.r, 0.0, 1.0));
  body += vec3(0.65, 0.85, 1.0) * sparkle * sparkleIntensity;

  float v = voronoiWater(vWorldPosition.xz, uTime);
  vec3 proc = voronoiBg + vec3(v);
  body = mix(body, proc, voronoiBlend * (0.55 + 0.45 * facing));

  float edgeFade = 1.0 - smoothstep(400.0, 2500.0, dist);
  body = mix(body * 0.96, body, edgeFade);

  float outAlpha = alpha;
  vec3 outRgb = body;

  if (uStyle == DAY_V) {
    outRgb = body;
  } else if (uStyle == NIGHT_V) {
    outRgb = mix(body * 0.38, body * vec3(0.5, 0.68, 0.92), 0.45);
    outAlpha = alpha * 0.78;
  }

  gl_FragColor = vec4(outRgb, outAlpha);

  ${SHADER_END}
}
`;
