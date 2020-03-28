# TaskManager
TaskManager is a simple task manager on Slack.

## Getting Started
### Installing
#### Install firebase tool

```sh
npm install -g firebase-tools
```

#### Clone this repository

```sh
git clone https://github.com/delly7/task-manager.git
```

#### Initialize firebase
Select or create your firebase project.

```sh
cd task-manager
firebase init
```

#### Set config of slack token

```sh
firebase functions:config:set slack.token="your-slack-app-token"
```

## Deployopment

```sh
 firebase deploy --only functions:task
```

## Usage on Slack
### Command list
* /\<command\> list - Display the user's task list
* /\<command\> add \<task\> - Add user's task
* /\<command\> end \<task\> - Check a box of \<task\>
* /\<command\> clear \<task\> - Remove \<task\> from task list
  * /\<command\> clear [ -a | all ] - Remove all tasks from task list
  * /\<command\> clear [ -d | done ] - Remove tasks which already done