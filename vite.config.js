import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { execSync } from "child_process";

const config = {};
let v = "1.0.0",
  r = "1.0.0";

if (process.env.npm_config_argv != undefined) {
  const argv = JSON.parse(process.env.npm_config_argv);
  // 获取自定义参数
  let idx = 2;
  const cooked = argv.cooked;
  const length = argv.cooked.length;
  while ((idx += 2) <= length) {
    config[cooked[idx - 2]] = cooked[idx - 1];
  }

  v = config["--V"];
  if (v == "undefined") {
    v = "1.0.0";
  }
  r = config["--R"];
  if (r == "undefined") {
    r = "1.0.0";
  }
}

const fileName = fileURLToPath(import.meta.url);
const _dirname = path.dirname(fileName);

// 自定义插件：在开发服务器启动时执行 generateModelList.js
const generateModelListPlugin = {
  name: "generate-model-list",
  configureServer(server) {
    // 在服务器启动时执行
    const runScript = () => {
      try {
        console.log("正在生成模型列表...");
        execSync("node generateModelList.js", { stdio: "inherit" });
        console.log("模型列表生成完成");
      } catch (error) {
        console.error("生成模型列表时出错:", error);
      }
    };

    // 初始执行
    runScript();

    // 监听模型目录变化
    const modelDir = path.join(_dirname, "public/models/outDoor");
    server.watcher.add(modelDir);
    server.watcher.on("change", (file) => {
      if (file.startsWith(modelDir)) {
        console.log("检测到模型文件变化，重新生成列表...");
        runScript();
      }
    });

    // 添加中间件来处理页面刷新
    server.middlewares.use((req, res, next) => {
      if (req.url === "/" || req.url === "/index.html") {
        console.log("页面刷新，重新生成模型列表...");
        runScript();
      }
      next();
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  base: "./", //公共路径配置
  outputDir: "projectNameV" + v + "R" + r,
  resolve: {
    alias: {
      "@": path.resolve(_dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      // 门锁接口：本地通过代理访问 JetLinks
      // 代码里 baseURL 使用 window.configs.smartLockApiBase = "/api/smart-lock"
      "/api/smart-lock": {
        target: "https://lot.nimt.edu.cn",
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      // 允许访问项目根目录之外的文件
      strict: false,
      allow: [".."],
    },
  },
  build: {
    manifest: false,
    sourcemap: false, // 构建后是否生成 source map 文件。如果为 true，将会创建一个独立的 source map 文件
    outDir: "docs",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
    },
  },
  plugins: [
    nodePolyfills({
      include: ["fs", "path"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
    viteStaticCopy({
      targets: [
        {
          src: "public/models/outDoor/*",
          dest: "models/outDoor",
        },
      ],
    }),
    generateModelListPlugin,
  ],
  publicDir: "public",
  assetsInclude: ["**/*.glb"],
  optimizeDeps: {
    include: ["**/*.glb"],
  },
});
