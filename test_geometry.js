import * as THREE from "https://cdn.skypack.dev/three@0.124.0";
import ky from "https://cdn.skypack.dev/kyouka@1.2.5";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/loaders/FBXLoader";
import { EffectComposer } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/postprocessing/EffectComposer";
import Stats from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/libs/stats.module";
import * as dat from "https://cdn.skypack.dev/dat.gui@0.7.7";
import { RGBELoader } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/loaders/RGBELoader";
import { MeshSurfaceSampler } from "https://cdn.skypack.dev/three@0.124.0/examples/jsm/math/MeshSurfaceSampler";
import gsap from "https://cdn.skypack.dev/gsap@3.7.1";

const morphParticlesVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

attribute vec3 aPositionBox;
attribute vec3 aPositionTorus;

uniform float uTransition1;
uniform float uTransition2;

void main(){
    vec3 transition1=mix(position,aPositionBox,uTransition1);
    vec3 transition2=mix(transition1,aPositionTorus,uTransition2);
    vec3 finalPos=transition2;
    vec4 modelPosition=modelMatrix*vec4(finalPos,1.);
    vec4 viewPosition=viewMatrix*modelPosition;
    vec4 projectedPosition=projectionMatrix*viewPosition;
    gl_Position=projectedPosition;
    gl_PointSize=3.;
    
    vUv=uv;
    vPosition=position;
}
`;

const morphParticlesFragmentShader = `
uniform float uTime;
uniform vec2 uMouse;
uniform vec2 uResolution;

varying vec2 vUv;
varying vec3 vPosition;

uniform vec3 uColor;

void main(){
    vec2 uv=vec2(gl_PointCoord.x,1.-gl_PointCoord.y);
    vec2 cUv=2.*uv-1.;
    vec3 color=vec3(1./length(cUv));
    color.rgb*=uColor;
    gl_FragColor=vec4(color,1.);
}
`;

const calcAspect = (el: HTMLElement) => el.clientWidth / el.clientHeight;

const getNormalizedMousePos = (e: MouseEvent | Touch) => {
  return {
    x: (e.clientX / window.innerWidth) * 2 - 1,
    y: -(e.clientY / window.innerHeight) * 2 + 1
  };
};

// 点转化为数组
const point2Array = (point) => [point.x, point.y, point.z];

// 从mesh上取样微粒位置信息
const sampleParticlesPositionFromMesh = (
  geometry: THREE.BufferGeometry,
  count = 10000
) => {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const particlesPosition = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const position = new THREE.Vector3();
    sampler.sample(position);
    particlesPosition.set(point2Array(position), i * 3);
  }
  return particlesPosition;
};

class Base {
  debug: boolean;
  container: HTMLElement | null;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  rendererParams!: Record<string, any>;
  perspectiveCameraParams!: Record<string, any>;
  orthographicCameraParams!: Record<string, any>;
  cameraPosition!: THREE.Vector3;
  lookAtPosition!: THREE.Vector3;
  renderer!: THREE.WebGLRenderer;
  controls!: OrbitControls;
  mousePos!: THREE.Vector2;
  raycaster!: THREE.Raycaster;
  sound!: THREE.Audio;
  stats!: Stats;
  composer!: EffectComposer;
  shaderMaterial!: THREE.ShaderMaterial;
  mouseSpeed!: number;
  viewport!: any;
  constructor(sel: string, debug = false) {
    this.debug = debug;
    this.container = document.querySelector(sel);
    this.perspectiveCameraParams = {
      fov: 75,
      near: 0.1,
      far: 100
    };
    this.orthographicCameraParams = {
      zoom: 2,
      near: -100,
      far: 1000
    };
    this.cameraPosition = new THREE.Vector3(0, 3, 10);
    this.lookAtPosition = new THREE.Vector3(0, 0, 0);
    this.rendererParams = {
      outputEncoding: THREE.LinearEncoding,
      config: {
        alpha: true,
        antialias: true
      }
    };
    this.mousePos = new THREE.Vector2(0, 0);
    this.mouseSpeed = 0;
  }
  // 初始化
  init() {
    this.createScene();
    this.createPerspectiveCamera();
    this.createRenderer();
    this.createMesh({});
    this.createLight();
    this.createOrbitControls();
    this.addListeners();
    this.setLoop();
  }
  // 创建场景
  createScene() {
    const scene = new THREE.Scene();
    if (this.debug) {
      scene.add(new THREE.AxesHelper());
      const stats = Stats();
      this.container!.appendChild(stats.dom);
      this.stats = stats;
    }
    this.scene = scene;
  }
  // 创建透视相机
  createPerspectiveCamera() {
    const { perspectiveCameraParams, cameraPosition, lookAtPosition } = this;
    const { fov, near, far } = perspectiveCameraParams;
    const aspect = calcAspect(this.container!);
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.copy(cameraPosition);
    camera.lookAt(lookAtPosition);
    this.camera = camera;
  }
  // 创建正交相机
  createOrthographicCamera() {
    const { orthographicCameraParams, cameraPosition, lookAtPosition } = this;
    const { left, right, top, bottom, near, far } = orthographicCameraParams;
    const camera = new THREE.OrthographicCamera(
      left,
      right,
      top,
      bottom,
      near,
      far
    );
    camera.position.copy(cameraPosition);
    camera.lookAt(lookAtPosition);
    this.camera = camera;
  }
  // 更新正交相机参数
  updateOrthographicCameraParams() {
    const { container } = this;
    const { zoom, near, far } = this.orthographicCameraParams;
    const aspect = calcAspect(container!);
    this.orthographicCameraParams = {
      left: -zoom * aspect,
      right: zoom * aspect,
      top: zoom,
      bottom: -zoom,
      near,
      far,
      zoom
    };
  }
  // 创建渲染
  createRenderer(useWebGL1 = false) {
    const { rendererParams } = this;
    const { outputEncoding, config } = rendererParams;
    const renderer = !useWebGL1
      ? new THREE.WebGLRenderer(config)
      : new THREE.WebGL1Renderer(config);
    renderer.setSize(this.container!.clientWidth, this.container!.clientHeight);
    renderer.outputEncoding = outputEncoding;
    this.resizeRendererToDisplaySize();
    this.container?.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.renderer.setClearColor(0x000000, 0);
  }
  // 允许投影
  enableShadow() {
    this.renderer.shadowMap.enabled = true;
  }
  // 调整渲染器尺寸
  resizeRendererToDisplaySize() {
    const { renderer } = this;
    if (!renderer) {
      return;
    }
    const canvas = renderer.domElement;
    const pixelRatio = window.devicePixelRatio;
    const { clientWidth, clientHeight } = canvas;
    const width = (clientWidth * pixelRatio) | 0;
    const height = (clientHeight * pixelRatio) | 0;
    const isResizeNeeded = canvas.width !== width || canvas.height !== height;
    if (isResizeNeeded) {
      renderer.setSize(width, height, false);
    }
    return isResizeNeeded;
  }
  // 创建网格
  createMesh(
    meshObject: MeshObject,
    container: THREE.Scene | THREE.Mesh = this.scene
  ) {
    const {
      geometry = new THREE.BoxGeometry(1, 1, 1),
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#d9dfc8")
      }),
      position = new THREE.Vector3(0, 0, 0)
    } = meshObject;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    container.add(mesh);
    return mesh;
  }
  // 创建光源
  createLight() {
    const dirLight = new THREE.DirectionalLight(
      new THREE.Color("#ffffff"),
      0.5
    );
    dirLight.position.set(0, 50, 0);
    this.scene.add(dirLight);
    const ambiLight = new THREE.AmbientLight(new THREE.Color("#ffffff"), 0.4);
    this.scene.add(ambiLight);
  }
  // 创建轨道控制
  createOrbitControls() {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    const { lookAtPosition } = this;
    controls.target.copy(lookAtPosition);
    controls.update();
    this.controls = controls;
  }
  // 监听事件
  addListeners() {
    this.onResize();
  }
  // 监听画面缩放
  onResize() {
    window.addEventListener("resize", (e) => {
      if (this.shaderMaterial) {
        this.shaderMaterial.uniforms.uResolution.value.x = window.innerWidth;
        this.shaderMaterial.uniforms.uResolution.value.y = window.innerHeight;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      } else {
        if (this.camera instanceof THREE.PerspectiveCamera) {
          const aspect = calcAspect(this.container!);
          const camera = this.camera as THREE.PerspectiveCamera;
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
        } else if (this.camera instanceof THREE.OrthographicCamera) {
          this.updateOrthographicCameraParams();
          const camera = this.camera as THREE.OrthographicCamera;
          const {
            left,
            right,
            top,
            bottom,
            near,
            far
          } = this.orthographicCameraParams;
          camera.left = left;
          camera.right = right;
          camera.top = top;
          camera.bottom = bottom;
          camera.near = near;
          camera.far = far;
          camera.updateProjectionMatrix();
        }
        this.renderer.setSize(
          this.container!.clientWidth,
          this.container!.clientHeight
        );
      }
    });
  }
  // 动画
  update() {
    console.log("animation");
  }
  // 渲染
  setLoop() {
    this.renderer.setAnimationLoop(() => {
      this.resizeRendererToDisplaySize();
      this.update();
      if (this.controls) {
        this.controls.update();
      }
      if (this.stats) {
        this.stats.update();
      }
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    });
  }
  // 创建文本
  createText(
    text = "",
    config: THREE.TextGeometryParameters,
    material: THREE.Material = new THREE.MeshStandardMaterial({
      color: "#ffffff"
    })
  ) {
    const geo = new THREE.TextGeometry(text, config);
    const mesh = new THREE.Mesh(geo, material);
    return mesh;
  }
  // 创建音效源
  createAudioSource() {
    const listener = new THREE.AudioListener();
    this.camera.add(listener);
    const sound = new THREE.Audio(listener);
    this.sound = sound;
  }
  // 加载音效
  loadAudio(url: string): Promise<AudioBuffer> {
    const loader = new THREE.AudioLoader();
    return new Promise((resolve) => {
      loader.load(url, (buffer) => {
        this.sound.setBuffer(buffer);
        resolve(buffer);
      });
    });
  }
  // 加载模型
  loadModel(url: string): Promise<THREE.Object3D> {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          console.log(model);
          resolve(model);
        },
        undefined,
        (err) => {
          console.log(err);
          reject();
        }
      );
    });
  }
  // 加载FBX模型
  loadFBXModel(url: string): Promise<THREE.Object3D> {
    const loader = new FBXLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (obj) => {
          resolve(obj);
        },
        undefined,
        (err) => {
          console.log(err);
          reject();
        }
      );
    });
  }
  // 加载字体
  loadFont(url: string): Promise<THREE.Font> {
    const loader = new THREE.FontLoader();
    return new Promise((resolve) => {
      loader.load(url, (font) => {
        resolve(font);
      });
    });
  }
  // 创建点选模型
  createRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.trackMousePos();
  }
  // 追踪鼠标位置
  trackMousePos() {
    window.addEventListener("mousemove", (e) => {
      this.setMousePos(e);
    });
    window.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        this.setMousePos(e.touches[0]);
      },
      { passive: false }
    );
    window.addEventListener("touchmove", (e: TouchEvent) => {
      this.setMousePos(e.touches[0]);
    });
  }
  // 设置鼠标位置
  setMousePos(e: MouseEvent | Touch) {
    const { x, y } = getNormalizedMousePos(e);
    this.mousePos.x = x;
    this.mousePos.y = y;
  }
  // 获取点击物
  getInterSects(container = this.scene): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.mousePos, this.camera);
    const intersects = this.raycaster.intersectObjects(
      container.children,
      true
    );
    return intersects;
  }
  // 选中点击物时
  onChooseIntersect(target: THREE.Object3D, container = this.scene) {
    const intersects = this.getInterSects(container);
    const intersect = intersects[0];
    if (!intersect || !intersect.face) {
      return null;
    }
    const { object } = intersect;
    return target === object ? intersect : null;
  }
  // 获取跟屏幕同像素的fov角度
  getScreenFov() {
    return ky.rad2deg(
      2 * Math.atan(window.innerHeight / 2 / this.cameraPosition.z)
    );
  }
  // 获取重心坐标系
  getBaryCoord(bufferGeometry: THREE.BufferGeometry) {
    // https://gist.github.com/mattdesl/e399418558b2b52b58f5edeafea3c16c
    const length = bufferGeometry.attributes.position.array.length;
    const count = length / 3;
    const bary = [];
    for (let i = 0; i < count; i++) {
      bary.push(0, 0, 1, 0, 1, 0, 1, 0, 0);
    }
    const aCenter = new Float32Array(bary);
    bufferGeometry.setAttribute(
      "aCenter",
      new THREE.BufferAttribute(aCenter, 3)
    );
  }
  // 追踪鼠标速度
  trackMouseSpeed() {
    // https://stackoverflow.com/questions/6417036/track-mouse-speed-with-js
    let lastMouseX = -1;
    let lastMouseY = -1;
    let mouseSpeed = 0;
    window.addEventListener("mousemove", (e) => {
      const mousex = e.pageX;
      const mousey = e.pageY;
      if (lastMouseX > -1) {
        mouseSpeed = Math.max(
          Math.abs(mousex - lastMouseX),
          Math.abs(mousey - lastMouseY)
        );
        this.mouseSpeed = mouseSpeed / 100;
      }
      lastMouseX = mousex;
      lastMouseY = mousey;
    });
    document.addEventListener("mouseleave", () => {
      this.mouseSpeed = 0;
    });
  }
  // 使用PCFSoft阴影
  usePCFSoftShadowMap() {
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  // 使用VSM阴影
  useVSMShadowMap() {
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
  }
  // 将相机的方向设为z轴
  setCameraUpZ() {
    this.camera.up.set(0, 0, 1);
  }
  // 获取viewport
  getViewport() {
    const { camera } = this;
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    const distance = camera.getWorldPosition(position).distanceTo(target);
    const fov = ((camera as any).fov * Math.PI) / 180; // convert vertical fov to radians
    const h = 2 * Math.tan(fov / 2) * distance; // visible height
    const w = h * (window.innerWidth / window.innerHeight);
    const viewport = { width: w, height: h };
    this.viewport = viewport;
  }
  // 加载HDR
  loadHDR(url: string): Promise<THREE.Texture> {
    const loader = new RGBELoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          const generator = new THREE.PMREMGenerator(this.renderer);
          const envmap = generator.fromEquirectangular(texture).texture;
          texture.dispose();
          generator.dispose();
          resolve(envmap);
        },
        undefined,
        (err) => {
          console.log(err);
          reject();
        }
      );
    });
  }
  // 从mesh上取样微粒位置信息
  sampleParticlesPositionFromMesh(
    geometry: THREE.BufferGeometry,
    count = 10000
  ) {
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const sampler = new MeshSurfaceSampler(mesh).build();
    const particlesPosition = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const position = new THREE.Vector3();
      sampler.sample(position);
      particlesPosition.set(point2Array(position), i * 3);
    }
    return particlesPosition;
  }
}

class MorphParticles extends Base {
  clock!: THREE.Clock;
  morphParticlesMaterial!: THREE.ShaderMaterial;
  params!: any;
  currentTransition!: number;
  constructor(sel: string, debug: boolean) {
    super(sel, debug);
    this.clock = new THREE.Clock();
    this.cameraPosition = new THREE.Vector3(0, 0, 2.5);
    this.params = {
      rotateSpeed: 0.01,
      pointColor: "#4ec0e9"
    };
    this.currentTransition = 0;
  }
  // 初始化
  init() {
    this.createScene();
    this.createPerspectiveCamera();
    this.createRenderer();
    this.createMorphParticlesMaterial();
    this.createParticles();
    this.createLight();
    // this.createDebugPanel();
    this.trackMousePos();
    this.onClickParticles();
    this.addListeners();
    this.setLoop();
  }
  // 创建材质
  createMorphParticlesMaterial() {
    const morphParticlesMaterial = new THREE.ShaderMaterial({
      vertexShader: morphParticlesVertexShader,
      fragmentShader: morphParticlesFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: {
          value: 0
        },
        uMouse: {
          value: new THREE.Vector2(0, 0)
        },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uTransition1: {
          value: 0
        },
        uTransition2: {
          value: 0
        },
        uColor: {
          value: new THREE.Color(this.params.pointColor)
        }
      }
    });
    this.morphParticlesMaterial = morphParticlesMaterial;
  }
  // 创建微粒体
  createParticles() {
    const geometry = new THREE.BufferGeometry();

    // sphere
    const sphereGeometry = new THREE.SphereBufferGeometry(1, 128, 128);
    const spherePositions = sampleParticlesPositionFromMesh(
      sphereGeometry.toNonIndexed()
    );
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(spherePositions, 3)
    );

    // box
    const boxGeometry = new THREE.BoxBufferGeometry(1, 1, 1, 128, 128);
    const boxPositions = sampleParticlesPositionFromMesh(
      boxGeometry.toNonIndexed()
    );
    geometry.setAttribute(
      "aPositionBox",
      new THREE.BufferAttribute(boxPositions, 3)
    );

    // torus
    const torusGeometry = new THREE.TorusBufferGeometry(0.7, 0.3, 128, 128);
    const torusPositions = sampleParticlesPositionFromMesh(
      torusGeometry.toNonIndexed()
    );
    geometry.setAttribute(
      "aPositionTorus",
      new THREE.BufferAttribute(torusPositions, 3)
    );

    const material = this.morphParticlesMaterial;

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
  }
  // 动画
  update() {
    const elapsedTime = this.clock.getElapsedTime();
    const mousePos = this.mousePos;
    if (this.morphParticlesMaterial) {
      this.morphParticlesMaterial.uniforms.uTime.value = elapsedTime;
      this.morphParticlesMaterial.uniforms.uMouse.value = mousePos;
    }
    const rotateSpeed = this.params.rotateSpeed;
    this.scene.rotation.x += rotateSpeed;
    this.scene.rotation.y += rotateSpeed;
  }
  // 创建调试面板
  createDebugPanel() {
    const gui = new dat.GUI();
    const uniforms = this.morphParticlesMaterial.uniforms;
    gui
      .add(uniforms.uTransition1, "value")
      .min(0)
      .max(1)
      .step(0.01)
      .name("transition1");
  }
  // 监听点击微粒
  onClickParticles() {
    document.addEventListener("click", () => {
      this.changeParticles();
    });
    document.addEventListener("touchstart", () => {
      this.changeParticles();
    });
  }
  // 改变微粒
  changeParticles() {
    let currentTransition = this.currentTransition;
    const uniforms = this.morphParticlesMaterial.uniforms;
    console.log(currentTransition);
    if (currentTransition === 0) {
      gsap.to(uniforms.uTransition1, {
        value: 1
      });
      this.currentTransition += 1;
    } else if (currentTransition === 1) {
      gsap.to(uniforms.uTransition2, {
        value: 1
      });
      this.currentTransition += 1;
    } else if (currentTransition === 2) {
      gsap.to(uniforms.uTransition2, {
        value: 0
      });
      this.currentTransition += 1;
    } else if (currentTransition === 3) {
      gsap.to(uniforms.uTransition1, {
        value: 0
      });
      this.currentTransition = 0;
    }
  }
}

const start = () => {
  const morphParticles = new MorphParticles(".morph-particles", false);
  morphParticles.init();
};

start();
