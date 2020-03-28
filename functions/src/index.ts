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

        // help (only visible for post user)
        if (command === 'help') {
            const body = 'TaskManagerのつかいかた\n `/task list`                 : 自分のタスク一覧\n `/task add <task>`      : <task>を追加\n `/task end <task>`      : <task>を終了（消さない）\n `/task clear <task>`   : <task>を削除　-aで全削除, -dで終了タスク全削除';
            res.send({
                text: body
            });
        }

        function send(body: string, type = 'in_channel') {
            res.send({
                text: body,
                response_type: type,
            });
        }

        // list
        function list(string: string) {
            return new Promise<string>(async resolve => {
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
                let desc: string = string;
                if (!task_str) {
                    desc += '現在 <@' + userid + '> の タスクはありません :palm_tree:';
                } else {
                    desc += '<@' + userid + '> のタスク一覧:\n' + task_str;
                }
                resolve(desc);
            });
        }

        // add
        function add() {
            return new Promise<string>(async (resolve, reject) => {
                if (text_args[0] === '') {
                    const error = new RequestError('No task name');
                    error.code = 500;
                    reject(error);
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
                resolve(desc);
            });
        }

        function end() {
            return new Promise<string>(async (resolve, reject) => {
                // end
                const task_str = text_args.join(' ');
                const endData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_str).endAt(task_str + '\uf8ff').get();
                if (endData.empty) {
                    const error = new RequestError('No such task');
                    error.code = 500;
                    reject(error);
                }

                let desc = '';
                const batch = db.batch();
                endData.docs.map(async doc => {
                    const doc_id = doc.id;
                    const task_name = doc.data().task_name;
                    const updated_at = new Date();
                    const docRef = db.collection('tasks').doc(doc_id);
                    batch.update(
                        docRef,
                        {
                            is_end: true,
                            updated_at: updated_at,
                        });
                    desc += '<@' + userid + '> のタスクを終了: ' + task_name + '\n';
                });
                // list
                resolve(batch.commit().then(async () => list(desc + '\n')));
            });
        }

        // clear
        function clear() {
            return new Promise<string>(async (resolve, reject) => {
                if (text_args[0] === '-a' || text_args[0] === 'all') {
                    // clear all
                    const queryData = await db.collection('tasks').where('user_id', '==', userid).get();
                    if (queryData.empty) {
                        const error = new RequestError('No tasks');
                        error.code = 500;
                        reject(error);
                    }
                    queryData.docs.map(async doc => {
                        const doc_id = doc.id;
                        await db.collection('tasks').doc(doc_id).delete();
                    });
                    const desc = '<@' + userid + '> のタスクをすべて完了';
                    resolve(desc);
                } else {
                    // clear
                    let desc = '';
                    let clearData;
                    if (text_args[0] === '-d' || text_args[0] === 'done') {
                        clearData = await db.collection('tasks').where('user_id', '==', userid).where('is_end', '==', true).get();
                    } else {
                        const task_name = text_args.join(' ');
                        clearData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_name).endAt(task_name + '\uf8ff').get();
                    }
                    if (clearData.empty) {
                        const error = new RequestError('No such task');
                        error.code = 500;
                        reject(error);
                    }

                    const batch = db.batch();
                    clearData.docs.map(async doc => {
                        const doc_id = doc.id;
                        const task_name = doc.data().task_name;
                        const docRef = db.collection('tasks').doc(doc_id);
                        batch.delete(docRef);
                        desc += '<@' + userid + '> のタスクを完了: ' + task_name + '\n';
                    });

                    // list
                    resolve(batch.commit().then(async () => list(desc + '\n')));
                }
            });
        }


        if (command === 'list' || !text_args) {
            await list('').then(value => send(value));
        } else if (command === 'add' && text_args) {
            await add().then(value => send(value));
        } else if (command === 'end' && text_args) {
            await end().then(value => send(value));
        } else if (command === 'clear' && text_args) {
            await clear().then(value => send(value));
        } else {
            const error = new RequestError('Bad usage');
            error.code = 500;
        }
    } catch (error) {
        res.send(error);
    }
});