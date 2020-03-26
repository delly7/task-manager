import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin'

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
admin.initializeApp(functions.config().firebase)
const db = admin.firestore()

class RequestError extends Error {
    code: number | undefined;
}

export const task = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
    try {
        if (req.method !== 'POST') {
            const error = new RequestError('Only POST requests are accepted');
            error.code = 405;
            throw error;
        }
        if (!req.body || req.body.token !== functions.config().slack.token) {
            console.log(req.body, functions.config().slack.token);
            const error = new RequestError('Invalid credentials');
            error.code = 401;
            throw error;
        }
        const [command, ...args] = req.body.text.split(' ');
        const username = req.body.user_name;
        const userid = req.body.user_id;
        const text_args = args;

        if (command === 'list' || !text_args) {
            // list
            let task_str = '';
            const queryData = await db.collection('tasks').where('user_id', '==', userid).orderBy('created_at', 'asc').get();

            const promises = queryData.docs.map(doc => {
                const obj = doc.data();
                if (!obj.is_end) {
                    task_str += ':black_square_button: ' + obj.task_name + '\n';
                } else {
                    task_str += ':ballot_box_with_check: ' + obj.task_name + '\n';
                }
            });
            await Promise.all(promises);
            let desc = '';
            if (!task_str) {
                desc = '現在 <@' + userid + '> の タスクはありません :palm_tree:';
            } else {
                desc = '<@' + userid + '> のタスク一覧:\n' + task_str;
            }
            res.send({
                text: desc,
                response_type: 'in_channel',
            });
        } else if (command === 'add' && text_args) {
            // add
            if (text_args[0] === '') {
                const error = new RequestError('No task name');
                error.code = 500;
                throw error;
            }
            const created_at = new Date();
            const task_name = text_args.join(' ');

            const queryData = await db.collection('tasks').where('user_id', '==', userid).where('task_name', '==', task_name).get();
            if (queryData.empty) {
                const data = {
                    user_name: username,
                    user_id: userid,
                    task_name: task_name,
                    is_end: false,
                    created_at: created_at,
                    updated_at: created_at,
                };
                await db.collection('tasks').add(data);
            }
            const desc = '<@' + userid + '> のタスクを追加: ' + task_name;
            res.send({
                text: desc,
                response_type: 'in_channel',
            });
        } else if (command === 'end' && text_args) {
            // end
            const task_name = text_args.join(' ');
            const endData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_name).endAt(task_name + '\uf8ff').get();
            if (endData.empty) {
                const error = new RequestError('No such task');
                error.code = 500;
                throw error;
            }

            let desc = '';
            const batch = db.batch();
            endData.docs.map(async doc => {
                const doc_id = doc.id;
                const updated_at = new Date();
                const docRef = db.collection('tasks').doc(doc_id);
                batch.update(
                    docRef,
                    {
                        is_end: true,
                        updated_at: updated_at,
                    });
            });
            // list
            let task_str = '';
            return batch.commit().then(async () => {
                const listData = await db.collection('tasks').where('user_id', '==', userid).orderBy('created_at', 'asc').get();
                const promises = listData.docs.map(doc => {
                    const obj = doc.data();
                    if (!obj.is_end) {
                        task_str += ':black_square_button: ' + obj.task_name + '\n';
                    } else {
                        task_str += ':ballot_box_with_check: ' + obj.task_name + '\n';
                    }
                });
                await Promise.all(promises);
                desc = '<@' + userid + '> のタスクを終了: ' + task_name + '\n';
                if (!task_str) {
                    desc += '現在 <@' + userid + '> の タスクはありません :palm_tree:';
                } else {
                    desc += '<@' + userid + '> のタスク一覧:\n' + task_str;
                }

                res.send({
                    text: desc,
                    response_type: 'in_channel',
                });
            });

        } else if (command === 'clear' && text_args) {
            if (text_args[0] === '-a' || text_args[0] === 'all') {
                // clear all
                const queryData = await db.collection('tasks').where('user_id', '==', userid).get();
                if (queryData.empty) {
                    const error = new RequestError('No tasks');
                    error.code = 500;
                    throw error;
                }
                queryData.docs.map(async doc => {
                    const doc_id = doc.id;
                    await db.collection('tasks').doc(doc_id).delete();
                });
                const desc = '<@' + userid + '> のタスクをすべて完了';
                res.send({
                    text: desc,
                    response_type: 'in_channel',
                });
            } else {
                // clear
                const task_name = text_args.join(' ');
                const clearData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_name).endAt(task_name + '\uf8ff').get();
                if (clearData.empty) {
                    const error = new RequestError('No such task');
                    error.code = 500;
                    throw error;
                }

                const batch = db.batch();
                 clearData.docs.map(async doc => {
                    const doc_id = doc.id;
                    const docRef = db.collection('tasks').doc(doc_id);
                    batch.delete(docRef);
                });

                // list
                let task_str = '';
                return batch.commit().then(async () => {
                    const listData = await db.collection('tasks').where('user_id', '==', userid).orderBy('created_at', 'asc').get();
                    const promises = listData.docs.map(doc => {
                        const obj = doc.data();
                        if (!obj.is_end) {
                            task_str += ':black_square_button: ' + obj.task_name + '\n';
                        } else {
                            task_str += ':ballot_box_with_check: ' + obj.task_name + '\n';
                        }
                    });
                    await Promise.all(promises);
                    let desc = '<@' + userid + '> のタスクを完了: ' + task_name + '\n';
                    if (!task_str) {
                        desc += '現在 <@' + userid + '> の タスクはありません :palm_tree:';
                    } else {
                        desc += '<@' + userid + '> のタスク一覧:\n' + task_str;
                    }

                    res.send({
                        text: desc,
                        response_type: 'in_channel',
                    });
                });
            }
        } else if (command === 'help') {
            // help
            const desc = 'TaskManagerのつかいかた\n `/task list`                 : 自分のタスク一覧\n `/task add <task>`      : <task>を追加\n `/task end <task>`      : <task>を終了（消さない）\n `/task clear <task>`   : <task>を削除　-aを指定すれば全削除する';
            res.send({
                text: desc,
                response_type: 'in_channel',
            });
        } else {
            const error = new RequestError('Bad usage');
            error.code = 500;
            throw error;
        }
    } catch (error) {
        res.send(error);
    }
});