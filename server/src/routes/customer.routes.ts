import { Router } from "express";
import { authenticate } from "../middleware/auth";
import multer from "multer";
import * as ctrl from "../controllers/customer.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

// 列表
router.get("/my", ctrl.listMy);
router.get("/public", ctrl.listPublic);
router.get("/all", ctrl.listAll);

// 国家列表
router.get("/countries", ctrl.getCountries);

// 报告统计
router.get("/report", ctrl.getReportStats);

// 导入
router.post("/import", upload.single("file"), ctrl.importExcel);

// 操作
router.post("/:id/claim", ctrl.claim);
router.post("/:id/release", ctrl.release);

// 详情 / 增删改
router.get("/:id", ctrl.getById);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
