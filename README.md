使用方法：
```
npm i
node server.js
```

启动参数：
```
# 指定端口
node server.js --port 8080

# 指定图标（会同时影响 favicon + 左上角 logo）
node server.js --icon ./icon.png

# 同时指定
node server.js --port 8080 --icon ./icon.png

# 自定义标题（浏览器标题 + 左上角标题）
node server.js --title "My Todo"

# 全部同时指定
node server.js --port 8080 --icon ./icon.png --title "My Todo"
```

也支持环境变量：
```
PORT=8080 TODO_ICON=./icon.png TODO_TITLE="My Todo" node server.js
```

截图展示
v1.0
<img width="2625" height="1795" alt="image" src="https://github.com/user-attachments/assets/e7eb835e-05ad-4d05-969c-faea7c329b08" />
V1.7
<img width="2541" height="1516" alt="image" src="https://github.com/user-attachments/assets/a239be12-4331-4edc-badb-9975c85b6911" />


更新日志:
https://github.com/cornradio/rbtodo/blob/main/todo.md
