import {
    db, Handler, PRIV, Context, ValidationError, UserModel,PERM
} from 'hydrooj';

const coll = db.collection('real_pass_percent');

interface RealPassPercent {
    _id: string; // 题目ID
    accepted: number; // 通过数
    submitted: number; // 提交数
    updatedBy: number; // 更新者ID
    updatedAt: Date; // 更新时间
    createdAt: Date; // 创建时间
}

declare module 'hydrooj' {
    interface Model {
        realPassPercent: typeof realPassPercentModel;
    }
    interface Collections {
        real_pass_percent: RealPassPercent;
    }
}

// 添加或更新题目的赛时通过率
async function set(pid: string, accepted: number, submitted: number, userId: number): Promise<void> {
    const now = new Date();
    await coll.updateOne(
        { _id: pid },
        {
            $set: {
                accepted,
                submitted,
                updatedBy: userId,
                updatedAt: now,
            },
            $setOnInsert: {
                _id: pid,
                createdAt: now,
            }
        },
        { upsert: true }
    );
}

// 获取题目的赛时通过率
async function get(pid: string): Promise<RealPassPercent | null> {
    return await coll.findOne({ _id: pid });
}

// 获取多个题目的赛时通过率
async function getMulti(pids: string[]): Promise<Record<string, RealPassPercent>> {
    const docs = await coll.find({ _id: { $in: pids } }).toArray();
    const result: Record<string, RealPassPercent> = {};
    for (const doc of docs) {
        result[doc._id] = doc;
    }
    return result;
}

// 分页获取所有题目的赛时通过率
async function getList(page: number, limit: number): Promise<{ docs: RealPassPercent[], total: number }> {
    const total = await coll.countDocuments();
    const docs = await coll.find({})
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();
    return { docs, total };
}

// 删除题目的赛时通过率
async function remove(pid: string): Promise<void> {
    await coll.deleteOne({ _id: pid });
}

const realPassPercentModel = { set, get, getMulti, getList, remove };
global.Hydro.model.realPassPercent = realPassPercentModel;

// 管理界面处理器
class RealPassPercentManageHandler extends Handler {
    async get() {
        this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        
        const page = Math.max(1, parseInt(this.request.query.page as string) || 1);
        const limit = 50;
          const { docs, total } = await realPassPercentModel.getList(page, limit);
        const updict = await UserModel.getMulti(docs.map(doc => doc.updatedBy));
        
        this.response.template = 'real_pass_percent_manage.html';
        this.response.body = {
            docs,
            updict,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
        };
    }    async post() {
        this.checkPerm(PERM.PERM_EDIT_HOMEWORK);

        const { pid, accepted, submitted } = this.request.body;

        if (!pid || pid.trim() === '') {
            throw new ValidationError('pid', 'Problem ID is required');
        }

        const acceptedNum = parseInt(accepted, 10);
        const submittedNum = parseInt(submitted, 10);
        
        if (isNaN(acceptedNum) || acceptedNum < 0) {
            throw new ValidationError('accepted', 'Accepted count must be a non-negative integer');
        }
        
        if (isNaN(submittedNum) || submittedNum < 0) {
            throw new ValidationError('submitted', 'Submitted count must be a non-negative integer');
        }
        
        if (acceptedNum > submittedNum) {
            throw new ValidationError('accepted', 'Accepted count cannot be greater than submitted count');
        }

        await realPassPercentModel.set(pid.trim(), acceptedNum, submittedNum, this.user._id);
        this.response.redirect = this.url('real_pass_percent_manage');
    }
}

// 编辑单个题目赛时通过率的处理器
class RealPassPercentEditHandler extends Handler {
    async get() {
        this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        
        const { pid } = this.request.params;
        const doc = await realPassPercentModel.get(pid);
        this.response.template = 'real_pass_percent_edit.html';
        this.response.body = { pid, doc };
    }    async post() {
        this.checkPerm(PERM.PERM_EDIT_HOMEWORK);

        const { pid } = this.request.params;
        const { accepted, submitted } = this.request.body;

        const acceptedNum = parseInt(accepted, 10);
        const submittedNum = parseInt(submitted, 10);
        
        if (isNaN(acceptedNum) || acceptedNum < 0) {
            throw new ValidationError('accepted', 'Accepted count must be a non-negative integer');
        }
        
        if (isNaN(submittedNum) || submittedNum < 0) {
            throw new ValidationError('submitted', 'Submitted count must be a non-negative integer');
        }
        
        if (acceptedNum > submittedNum) {
            throw new ValidationError('accepted', 'Accepted count cannot be greater than submitted count');
        }

        await realPassPercentModel.set(pid, acceptedNum, submittedNum, this.user._id);
        this.response.redirect = this.url('real_pass_percent_manage');
    }
}

// 删除处理器
class RealPassPercentDelHandler extends Handler {
    async get() {
        this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        
        const { pid } = this.request.params;
        await realPassPercentModel.remove(pid);
        this.response.redirect = this.url('real_pass_percent_manage');
    }
}

// API 处理器，用于获取赛时通过率数据
class RealPassPercentApiHandler extends Handler {
    async get() {
        // 添加权限检查 - 只要能查看训练就可以访问API
        this.checkPerm(PERM.PERM_VIEW_TRAINING);
        
        try {
            // 获取 pids 参数
            const { pids } = this.request.query;
            
            if (!pids || (Array.isArray(pids) && pids.length === 0)) {
                this.response.body = {};
                return;
            }
            
            // 确保 pidArray 是字符串数组
            const pidArray = Array.isArray(pids) ? pids.map(String) : [String(pids)];
            
            // 查询数据库
            const realPassPercentDict = await realPassPercentModel.getMulti(pidArray);
            
            this.response.body = realPassPercentDict;
        } catch (error) {
            console.error('Error in RealPassPercentApiHandler:', error);
            this.response.body = {
                error: error.message || 'Internal server error'
            };
        }
    }
}

export async function apply(ctx: Context) {
    // 注册路由
    ctx.Route('real_pass_percent_manage', '/real-pass-percent', RealPassPercentManageHandler, PERM.PERM_EDIT_HOMEWORK);
    ctx.Route('real_pass_percent_edit', '/real-pass-percent/:pid', RealPassPercentEditHandler, PERM.PERM_EDIT_HOMEWORK);
    ctx.Route('real_pass_percent_del', '/real-pass-percent/:pid/del', RealPassPercentDelHandler, PERM.PERM_EDIT_HOMEWORK);
    ctx.Route('real_pass_percent_api', '/real-pass-percent/api/real-pass-percent', RealPassPercentApiHandler, PERM.PERM_VIEW_TRAINING);
}
