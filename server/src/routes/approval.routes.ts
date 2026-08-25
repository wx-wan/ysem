import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/approval.controller";

const router = Router();
router.use(authenticate);

router.get("/", ctrl.list);
router.get("/:type", ctrl.getByType);
router.post("/", ctrl.save);
router.delete("/:type", ctrl.remove);

export default router;
