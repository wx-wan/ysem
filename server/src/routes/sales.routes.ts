import { Router } from 'express';
import multer from 'multer';
import {
  getPipelines, getKanban, getPipeline, createPipeline,
  updatePipeline, changeStage, deletePipeline, batchDelete,
  importExcel, getAssignUsers,
} from '../controllers/sales.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

router.get('/assign-users', getAssignUsers);          // 获取可分配用户
router.get('/kanban', getKanban);                      // 看板数据
router.post('/import', upload.single('file'), importExcel); // Excel 导入
router.get('/', getPipelines);                         // 列表
router.get('/:id', getPipeline);                       // 详情
router.post('/', createPipeline);                      // 创建
router.put('/:id', updatePipeline);                    // 更新
router.patch('/:id/stage', changeStage);               // 阶段变更
router.delete('/batch', batchDelete);                  // 批量删除（注意：需放在 /:id 前）
router.delete('/:id', deletePipeline);                 // 删除

export default router;
