import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

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
        if (!req.body || req.body.token !== functions.config().slack.app.token) {
            console.log(req.body, functions.config().slack.token);
            const error = new RequestError('Invalid credentials');
            error.code = 401;
            throw error;
        }
        const [command, ...args] = req.body.text.split(' ');
        const username = req.body.user_name;
        const userid = req.body.user_id;
        const channel_id = req.body.channel_id;

        // help (only visible for post user)
        if (command === 'help') {
            const body = 'TaskManagerのつかいかた\n '
                + '`/task list`                : 自分のタスク一覧\n '
                + '`/task add <task>`      : <task>を追加\n'
                + '`/task start <task>`   : <task>を開始\n'
                + '`/task stop <task>`      : <task>を停止\n'
                + '`/task end <task>`      : <task>を終了\n '
                + '`/task clear <task>`   : <task>を削除　-aで全削除, -dで終了タスク全削除';
            response(body)
        }

        // slash command response
        function response(body: string, type = 'ephemeral') {
            res.send({
                text: body,
                response_type: type,
            });
        }

        // post message via slack web API
        function post(body: string) {
            return new Promise<string>(async (resolve) => {
                const token = functions.config().slack.oauth.token;
                const url = 'https://slack.com/api/chat.postMessage';

                const result = await axios.request({
                    headers: {
                        'authorization': `Bearer ${token}`
                    },
                    url,
                    method: "POST",
                    data: {
                        channel: channel_id,
                        text: body
                    }
                });
                resolve(result.data);
            });
        }

        // list
        function list(string: string) {
            return new Promise<string>(async resolve => {
                const task_str = new Array;
                const queryData = await db.collection('tasks').where('user_id', '==', userid).orderBy('created_at', 'asc').get();

                const promises = queryData.docs.map(doc => {
                    const obj = doc.data();
                    switch (obj.status) {
                        case 'open':
                            task_str.push(':black_square_button: ' + obj.task_name);
                            break;
                        case 'in_progress':
                            task_str.push(':arrow_right: ' + obj.task_name);
                            break;
                        case 'resolved':
                            task_str.push(':ballot_box_with_check: ' + obj.task_name);
                            break;
                        default:
                            task_str.push(':black_square_button: ' + obj.task_name);
                            break;
                    }
                });
                await Promise.all(promises);
                let desc: string = string;
                if (!task_str) {
                    desc += '現在 <@' + userid + '> の タスクはありません :palm_tree:';
                } else {
                    desc += '<@' + userid + '> のタスク一覧:\n' + task_str.join('\n');
                }
                resolve(desc);
            });
        }

        // add
        function add() {
            return new Promise<string>(async (resolve, reject) => {
                try {
                    if (args[0] === '') {
                        const error = new RequestError('No task name');
                        throw error;
                    }
                    const created_at = new Date();
                    const task_name = args.join(' ');

                    const queryData = await db.collection('tasks').where('user_id', '==', userid).where('task_name', '==', task_name).get();
                    if (queryData.empty) {
                        const data = {
                            user_name: username,
                            user_id: userid,
                            task_name: task_name,
                            status: 'open',
                            created_at: created_at,
                            updated_at: created_at,
                        };
                        await db.collection('tasks').add(data);
                    }
                    const desc = '<@' + userid + '> のタスクを追加: ' + task_name;
                    resolve(desc);
                } catch (error) {
                    error.code = 500;
                    reject(error);
                }
            });
        }

        // start
        function start() {
            return new Promise<string>(async (resolve, reject) => {
                try {
                    // find
                    const task_str = args.join(' ');
                    const desc = new Array();
                    let startData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_str).endAt(task_str + '\uf8ff').get();
                    // add
                    if (startData.empty) {
                        await add();
                        startData = await db.collection('tasks').where('user_id', '==', userid).where('task_name', '==', task_str).get();
                    }

                    if (startData.docs.length > 1) {
                        const error = new RequestError('Can\'t specify task');
                        throw error;
                    }
                    startData.docs.map(async doc => {
                        const doc_id = doc.id;
                        const task_name = doc.data().task_name;
                        const updated_at = new Date();
                        desc.push('<@' + userid + '> のタスクを開始: ' + task_name);
                        await db.collection('tasks').doc(doc_id).update(
                            {
                                status: 'in_progress',
                                updated_at: updated_at,
                            });
                    });
                    resolve(desc.join('\n'));
                } catch (error) {
                    error.code = 500;
                    reject(error);
                }
            });
        }

        // stop
        function stop() {
            return new Promise<string>(async (resolve, reject) => {
                try {
                    const task_str = args.join(' ');
                    const stopData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_str).endAt(task_str + '\uf8ff').get();
                    if (stopData.empty) {
                        const error = new RequestError('No such task');
                        throw error;
                    }

                    const desc = new Array;
                    if (stopData.docs.length !== 1) {
                        const error = new RequestError('Can\'t specify task');
                        throw error;
                    }
                    stopData.docs.map(async doc => {
                        const doc_id = doc.id;
                        const task_name = doc.data().task_name;
                        const updated_at = new Date();
                        desc.push('<@' + userid + '> のタスクを停止: ' + task_name);
                        await db.collection('tasks').doc(doc_id).update(
                            {
                                status: 'open',
                                updated_at: updated_at,
                            });
                    });
                    resolve(desc.join('\n'));
                } catch (error) {
                    error.code = 500;
                    reject(error);
                }
            });
        }

        // end
        function end() {
            return new Promise<string>(async (resolve, reject) => {
                try {
                    const task_str = args.join(' ');
                    const endData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_str).endAt(task_str + '\uf8ff').get();
                    if (endData.empty) {
                        const error = new RequestError('No such task');
                        throw error;
                    }

                    const desc = new Array;
                    const batch = db.batch();
                    endData.docs.map(async doc => {
                        const doc_id = doc.id;
                        const task_name = doc.data().task_name;
                        const updated_at = new Date();
                        const docRef = db.collection('tasks').doc(doc_id);
                        batch.update(
                            docRef,
                            {
                                status: 'resolved',
                                updated_at: updated_at,
                            });
                        desc.push('<@' + userid + '> のタスクを終了: ' + task_name);
                    });

                    // list
                    resolve(batch.commit().then(async () => list(desc.join('\n') + '\n\n')));
                } catch (error) {
                    error.code = 500;
                    reject(error);
                }
            });
        }

        // clear
        function clear() {
            return new Promise<string>(async (resolve, reject) => {
                try {
                    if (args[0] === '-a' || args[0] === 'all') {
                        // clear all
                        const queryData = await db.collection('tasks').where('user_id', '==', userid).get();
                        if (queryData.empty) {
                            const error = new RequestError('No tasks');
                            throw error;
                        }
                        queryData.docs.map(async doc => {
                            const doc_id = doc.id;
                            await db.collection('tasks').doc(doc_id).delete();
                        });
                        const desc = '<@' + userid + '> のタスクをすべて完了';
                        resolve(desc);
                    } else {
                        // clear
                        const desc = new Array;
                        let clearData;
                        if (args[0] === '-d' || args[0] === 'done') {
                            clearData = await db.collection('tasks').where('user_id', '==', userid).where('status', '==', 'resolved').get();
                        } else {
                            const task_name = args.join(' ');
                            clearData = await db.collection('tasks').where('user_id', '==', userid).orderBy('task_name', 'asc').startAt(task_name).endAt(task_name + '\uf8ff').get();
                        }
                        if (clearData.empty) {
                            const error = new RequestError('No such task');
                            throw error;
                        }

                        const batch = db.batch();
                        clearData.docs.map(async doc => {
                            const doc_id = doc.id;
                            const task_name = doc.data().task_name;
                            const docRef = db.collection('tasks').doc(doc_id);
                            batch.delete(docRef);
                            desc.push('<@' + userid + '> のタスクを完了: ' + task_name);
                        });

                        // list
                        resolve(batch.commit().then(async () => list(desc.join('\n') + '\n\n')));
                    }
                } catch (error) {
                    error.code = 500;
                    reject(error);
                }
            });
        }

        if (command === 'list' || !args) {
            await list('').then(value => post(value));
            res.status(200).send('');
        } else if (command === 'add' && args) {
            await add().then(value => post(value));
            res.status(200).send('');
        } else if (command === 'start' && args) {
            await start().then(value => post(value));
            res.status(200).send('');
        } else if (command === 'stop' && args) {
            await stop().then(value => post(value));
            res.status(200).send('');
        } else if (command === 'end' && args) {
            await end().then(value => post(value));
            res.status(200).send('');
        } else if (command === 'clear' && args) {
            await clear().then(value => post(value));
            res.status(200).send('');
        } else {
            const error = new RequestError('Bad usage');
            error.code = 500;
            throw error;
        }
    } catch (error) {
        res.send(error);
    }
});