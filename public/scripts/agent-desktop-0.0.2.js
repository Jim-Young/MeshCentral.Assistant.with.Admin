/** 
* @description Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.2g
*/

// Construct a MeshServer object
var CreateAgentRemoteDesktop = function (canvasid, scrolldiv) {
    var obj = {}
    obj.CanvasId = canvasid;
    if (typeof canvasid === 'string') obj.CanvasId = Q(canvasid);
    obj.Canvas = obj.CanvasId.getContext("2d");
    obj.scrolldiv = scrolldiv;
    obj.State = 0;
    obj.PendingOperations = [];
    obj.tilesReceived = 0;
    obj.TilesDrawn = 0;
    obj.KillDraw = 0;
    obj.ipad = false;
    obj.tabletKeyboardVisible = false;
    obj.LastX = 0;
    obj.LastY = 0;
    obj.touchenabled = 0;
    obj.submenuoffset = 0;
    obj.touchtimer = null;
    obj.TouchArray = {};
    obj.connectmode = 0; // 0 = HTTP, 1 = WebSocket, 2 = WebRTC
    obj.connectioncount = 0;
    obj.rotation = 0;
    obj.protocol = 2; // KVM

    obj.sessionid = 0;
    obj.username;
    obj.oldie = false;
    obj.CompressionLevel = 50;
    obj.ScalingLevel = 1024;
    obj.FrameRateTimer = 50;
    obj.FirstDraw = false;

    obj.ScreenWidth = 960;
    obj.ScreenHeight = 700;
    obj.width = 960;
    obj.height = 960;

    obj.onScreenResize = null;
    obj.onMessage = null;
    obj.onConnectCountChanged = null;
    obj.onDebugMessage = null;
    obj.onTouchEnabledChanged = null;

    obj.Start = function () {
        obj.State = 0;
    }

    obj.Stop = function () {
        obj.setRotation(0);
        obj.UnGrabKeyInput();
        obj.UnGrabMouseInput();
        obj.touchenabled = 0;
        if (obj.onScreenResize != null) obj.onScreenResize(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId);
        obj.Canvas.clearRect(0, 0, obj.CanvasId.width, obj.CanvasId.height);
    }

    obj.xxStateChange = function (newstate) {
        if (obj.State == newstate) return;
        obj.State = newstate;
        //console.log('xxStateChange', newstate);
        switch (newstate) {
            case 0: {
                // Disconnect
                obj.Stop();
                break;
            }
            case 3: {
                // Websocket connected

                break;
            }
        }
    }

    obj.Send = function (x) {
        //console.log("KSend(" + x.length + "): " + rstr2hex(x));
        obj.parent.Send(x);
    }

    // KVM Control.
    // Routines for processing incoming packets from the AJAX server, and handling individual messages.
    obj.ProcessPictureMsg = function (str, X, Y) {
        //if (obj.targetnode != null) obj.Debug("ProcessPictureMsg " + X + "," + Y + " - " + obj.targetnode.substring(0, 8));
        var tile = new Image();
        obj.tilesReceived++;
        var r = obj.tilesReceived;
        tile.src = "data:image/jpeg;base64," + btoa(str.substring(4, str.length));
        tile.onload = function () {
            if (obj.Canvas != null && obj.KillDraw < r && obj.State != 0) {
                obj.PendingOperations.push([r, 2, tile, X, Y]);
                while (obj.DoPendingOperations()) { }
            }
        }
    }

    obj.DoPendingOperations = function () {
        if (obj.PendingOperations.length == 0) return false;
        for (var i = 0; i < obj.PendingOperations.length; i++) { // && KillDraw < tilesDrawn
            var Msg = obj.PendingOperations[i];
            if (Msg[0] == (obj.TilesDrawn + 1)) {
                if (Msg[1] == 1) { obj.ProcessCopyRectMsg(Msg[2]); }
                else if (Msg[1] == 2) { obj.Canvas.drawImage(Msg[2], obj.rotX(Msg[3], Msg[4]), obj.rotY(Msg[3], Msg[4])); delete Msg[2]; }
                obj.PendingOperations.splice(i, 1);
                delete Msg;
                obj.TilesDrawn++;
                if (obj.TilesDrawn == obj.tilesReceived && obj.KillDraw < obj.TilesDrawn) { obj.KillDraw = obj.TilesDrawn = obj.tilesReceived = 0; }
                return true;
            }
        }
        if (obj.oldie && obj.PendingOperations.length > 0) { obj.TilesDrawn++; }
        return false;
    }

    obj.ProcessCopyRectMsg = function (str) {
        var SX = ((str.charCodeAt(0) & 0xFF) << 8) + (str.charCodeAt(1) & 0xFF);
        var SY = ((str.charCodeAt(2) & 0xFF) << 8) + (str.charCodeAt(3) & 0xFF);
        var DX = ((str.charCodeAt(4) & 0xFF) << 8) + (str.charCodeAt(5) & 0xFF);
        var DY = ((str.charCodeAt(6) & 0xFF) << 8) + (str.charCodeAt(7) & 0xFF);
        var WIDTH = ((str.charCodeAt(8) & 0xFF) << 8) + (str.charCodeAt(9) & 0xFF);
        var HEIGHT = ((str.charCodeAt(10) & 0xFF) << 8) + (str.charCodeAt(11) & 0xFF);
        obj.Canvas.drawImage(Canvas.canvas, SX, SY, WIDTH, HEIGHT, DX, DY, WIDTH, HEIGHT);
    }

    obj.SendUnPause = function () {
        //obj.Debug("SendUnPause");
        //obj.xxStateChange(3);
        obj.Send(String.fromCharCode(0x00, 0x08, 0x00, 0x05, 0x00));
    }

    obj.SendPause = function () {
        //obj.Debug("SendPause");
        //obj.xxStateChange(2);
        obj.Send(String.fromCharCode(0x00, 0x08, 0x00, 0x05, 0x01));
    }

    obj.SendCompressionLevel = function (type, level, scaling, frametimer) {
        if (level) { obj.CompressionLevel = level; }
        if (scaling) { obj.ScalingLevel = scaling; }
        if (frametimer) { obj.FrameRateTimer = frametimer; }
        obj.Send(String.fromCharCode(0x00, 0x05, 0x00, 0x0A, type, obj.CompressionLevel) + obj.shortToStr(obj.ScalingLevel) + obj.shortToStr(obj.FrameRateTimer));
    }

    obj.SendRefresh = function () {
        obj.Send(String.fromCharCode(0x00, 0x06, 0x00, 0x04));
    }

    obj.ProcessScreenMsg = function (width, height) {
        //obj.Debug("ProcessScreenMsg: " + width + " x " + height);
        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.rotation = 0;
        obj.FirstDraw = true;
        obj.ScreenWidth = obj.width = width;
        obj.ScreenHeight = obj.height = height;
        obj.KillDraw = obj.tilesReceived;
        while (obj.PendingOperations.length > 0) { obj.PendingOperations.shift(); }
        obj.SendCompressionLevel(1);
        obj.SendUnPause();
    }

    obj.ProcessData = function (str) {
        if (str.length < 4) return;
        var cmdmsg = null, X = 0, Y = 0, command = ReadShort(str, 0), cmdsize = ReadShort(str, 2);
        if (command >= 18) { console.error("Invalid KVM command " + command + " of size " + cmdsize); obj.parent.Stop(); return; }
        if (cmdsize > str.length) return;
        //meshOnDebug("KVM Command: " + command + " Len:" + cmdsize);

        if (command == 3 || command == 4 || command == 7) {
            cmdmsg = str.substring(4, cmdsize);
            X = ((cmdmsg.charCodeAt(0) & 0xFF) << 8) + (cmdmsg.charCodeAt(1) & 0xFF);
            Y = ((cmdmsg.charCodeAt(2) & 0xFF) << 8) + (cmdmsg.charCodeAt(3) & 0xFF);
        }

        switch (command) {
            case 3: // Tile
                if (obj.FirstDraw) obj.onResize();
                obj.ProcessPictureMsg(cmdmsg, X, Y);
                break;
            case 4: // Tile Copy
                if (obj.FirstDraw) obj.onResize();
                if (obj.TilesDrawn == obj.tilesReceived) {
                    obj.ProcessCopyRectMsg(cmdmsg);
                } else {
                    obj.PendingOperations.push([ ++tilesReceived, 1, cmdmsg ]);
                }
                break;
            case 7: // Screen size
                obj.ProcessScreenMsg(X, Y);
                obj.SendKeyMsgKC(obj.KeyAction.UP, 16); // Shift
                obj.SendKeyMsgKC(obj.KeyAction.UP, 17); // Ctrl
                obj.SendKeyMsgKC(obj.KeyAction.UP, 18); // Alt
                obj.SendKeyMsgKC(obj.KeyAction.UP, 91); // Left-Windows
                obj.SendKeyMsgKC(obj.KeyAction.UP, 92); // Right-Windows
                obj.Send(String.fromCharCode(0x00, 0x0E, 0x00, 0x04));
                break;
            case 11: // GetDisplays
                var dcount = ((str.charCodeAt(4) & 0xFF) << 8) + (str.charCodeAt(5) & 0xFF);
                if (dcount == 0) {
                    // One display present
                    if (document.getElementById('termdisplays') != null) document.getElementById('termdisplays').style.display = 'none';
                    if (document.getElementById('termdisplays2') != null) document.getElementById('termdisplays2').style.display = 'none';
                } else {
                    // Many displays present
                    var seldisp = ((str.charCodeAt(6 + (dcount * 2)) & 0xFF) << 8) + (str.charCodeAt(7 + (dcount * 2)) & 0xFF);
                    var selitem = 0;
                    var myOptions = [];
                    for (var i = 0; i < dcount; i++) {
                        var disp = ((str.charCodeAt(6 + (i * 2)) & 0xFF) << 8) + (str.charCodeAt(7 + (i * 2)) & 0xFF);
                        if (disp == 65535) {
                            myOptions.push('All Displays');
                        } else {
                            myOptions.push('Display ' + disp);
                        }
                        if (disp == seldisp) selitem = i;
                    }
                }
                // TODO
                break;
            case 12: // SetDisplay
                break;
            case 14: // KVM_INIT_TOUCH
                obj.touchenabled = 1;
                obj.TouchArray = {};
                if (obj.onTouchEnabledChanged != null) obj.onTouchEnabledChanged(obj.touchenabled);
                break;
            case 15: // KVM_TOUCH
                obj.TouchArray = {};
                break;
            case 16: // MNG_KVM_CONNECTCOUNT
                obj.connectioncount = ReadInt(str, 4);
                //obj.Debug("Got KVM Connect Count: " + obj.connectioncount);
                if (obj.onConnectCountChanged != null) obj.onConnectCountChanged(obj.connectioncount, obj);
                break;
            case 17: // MNG_KVM_MESSAGE
                //obj.Debug("Got KVM Message: " + str.substring(4, cmdsize));
                if (obj.onMessage != null) obj.onMessage(str.substring(4, cmdsize), obj);
                break;
        }
    }

    // Keyboard and Mouse I/O.
    obj.MouseButton = { "NONE": 0x00, "LEFT": 0x02, "RIGHT": 0x08, "MIDDLE": 0x20 };
    obj.KeyAction = { "NONE": 0, "DOWN": 1, "UP": 2, "SCROLL": 3, "EXUP": 4, "EXDOWN": 5 };
    obj.InputType = { "KEY": 1, "MOUSE": 2, "CTRLALTDEL": 10, "TOUCH": 15 };
    obj.Alternate = 0;

    obj.SendKeyMsg = function (action, event) {
        if (action == null) return;
        if (!event) { var event = window.event; }
        var kc = event.keyCode;
        if (kc == 0x3B) kc = 0xBA; // ';' key
        obj.SendKeyMsgKC(action, kc);
    }

    obj.SendMessage = function (msg) {
        if (obj.State == 3) obj.Send(String.fromCharCode(0x00, 0x11) + obj.shortToStr(4 + msg.length) + msg); // 0x11 = 17 MNG_KVM_MESSAGE
    }

    obj.SendKeyMsgKC = function (action, kc) {
        if (obj.State == 3) obj.Send(String.fromCharCode(0x00, obj.InputType.KEY, 0x00, 0x06, (action - 1), kc));
    }

    obj.sendcad = function() { obj.SendCtrlAltDelMsg(); }

    obj.SendCtrlAltDelMsg = function () {
        if (obj.State == 3) { obj.Send(String.fromCharCode(0x00, obj.InputType.CTRLALTDEL, 0x00, 0x04)); }
    }

    obj.SendEscKey = function () {
        if (obj.State == 3) obj.Send(String.fromCharCode(0x00, obj.InputType.KEY, 0x00, 0x06, 0x00, 0x1B, 0x00, obj.InputType.KEY, 0x00, 0x06, 0x01, 0x1B));
    }

    obj.SendStartMsg = function () {
        obj.SendKeyMsgKC(obj.KeyAction.EXDOWN, 0x5B); // L-Windows
        obj.SendKeyMsgKC(obj.KeyAction.EXUP, 0x5B); // L-Windows
    }

    obj.SendCharmsMsg = function () {
        obj.SendKeyMsgKC(obj.KeyAction.EXDOWN, 0x5B); // L-Windows
        obj.SendKeyMsgKC(obj.KeyAction.DOWN, 67); // C
        obj.SendKeyMsgKC(obj.KeyAction.UP, 67); // C
        obj.SendKeyMsgKC(obj.KeyAction.EXUP, 0x5B); // L-Windows
    }

    obj.SendTouchMsg1 = function (id, flags, x, y) {
        if (obj.State == 3) obj.Send(String.fromCharCode(0x00, obj.InputType.TOUCH) + obj.shortToStr(14) + String.fromCharCode(0x01, id) + obj.intToStr(flags) + obj.shortToStr(x) + obj.shortToStr(y));
    }

    obj.SendTouchMsg2 = function (id, flags) {
        var msg = '';
        var flags2;
        var str = "TOUCHSEND: ";
        for (var k in obj.TouchArray) {
            if (k == id) { flags2 = flags; } else {
                if (obj.TouchArray[k].f == 1) { flags2 = 0x00010000 | 0x00000002 | 0x00000004; obj.TouchArray[k].f = 3; str += "START" + k; } // POINTER_FLAG_DOWN
                else if (obj.TouchArray[k].f == 2) { flags2 = 0x00040000; str += "STOP" + k; } // POINTER_FLAG_UP
                else flags2 = 0x00000002 | 0x00000004 | 0x00020000; // POINTER_FLAG_UPDATE
            }
            msg += String.fromCharCode(k) + obj.intToStr(flags2) + obj.shortToStr(obj.TouchArray[k].x) + obj.shortToStr(obj.TouchArray[k].y);
            if (obj.TouchArray[k].f == 2) delete obj.TouchArray[k];
        }
        if (obj.State == 3) obj.Send(String.fromCharCode(0x00, obj.InputType.TOUCH) + obj.shortToStr(5 + msg.length) + String.fromCharCode(0x02) + msg);
        if (Object.keys(obj.TouchArray).length == 0 && obj.touchtimer != null) { clearInterval(obj.touchtimer); obj.touchtimer = null; }
    }

    obj.SendMouseMsg = function (Action, event) {
        if (obj.State != 3) return;
        if (Action != null && obj.Canvas != null) {
            if (!event) { var event = window.event; }
            var ScaleFactorHeight = (obj.Canvas.canvas.height / obj.CanvasId.clientHeight);
            var ScaleFactorWidth = (obj.Canvas.canvas.width / obj.CanvasId.clientWidth);
            var Offsets = obj.GetPositionOfControl(obj.Canvas.canvas);
            var X = ((event.pageX - Offsets[0]) * ScaleFactorWidth);
            var Y = ((event.pageY - Offsets[1]) * ScaleFactorHeight);

            if (X >= 0 && X <= obj.Canvas.canvas.width && Y >= 0 && Y <= obj.Canvas.canvas.height) {
                var Button = 0;
                var Delta = 0;
                if (Action == obj.KeyAction.UP || Action == obj.KeyAction.DOWN) {
                    if (event.which) { ((event.which == 1) ? (Button = obj.MouseButton.LEFT) : ((event.which == 2) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                    else if (event.button) { ((event.button == 0) ? (Button = obj.MouseButton.LEFT) : ((event.button == 1) ? (Button = obj.MouseButton.MIDDLE) : (Button = obj.MouseButton.RIGHT))); }
                }
                else if (Action == obj.KeyAction.SCROLL) {
                    if (event.detail) { Delta = (-1 * (event.detail * 120)); } else if (event.wheelDelta) { Delta = (event.wheelDelta * 3); }
                }

                var MouseMsg = "";
                if (Action == obj.KeyAction.SCROLL) MouseMsg = String.fromCharCode(0x00, obj.InputType.MOUSE, 0x00, 0x0C, 0x00, ((Action == obj.KeyAction.DOWN) ? Button : ((Button * 2) & 0xFF)), ((X / 256) & 0xFF), (X & 0xFF), ((Y / 256) & 0xFF), (Y & 0xFF), ((Delta / 256) & 0xFF), (Delta & 0xFF));
                else MouseMsg = String.fromCharCode(0x00, obj.InputType.MOUSE, 0x00, 0x0A, 0x00, ((Action == obj.KeyAction.DOWN) ? Button : ((Button * 2) & 0xFF)), ((X / 256) & 0xFF), (X & 0xFF), ((Y / 256) & 0xFF), (Y & 0xFF));
                if (obj.Action == obj.KeyAction.NONE) { if (obj.Alternate == 0 || obj.ipad) { obj.Send(MouseMsg); obj.Alternate = 1; } else { obj.Alternate = 0; } } else { obj.Send(MouseMsg); }
            }
        }
    }

    obj.GetDisplayNumbers = function () { obj.Send(String.fromCharCode(0x00, 0x0B, 0x00, 0x04)); } // Get Terminal display
    obj.SetDisplay = function (number) { obj.Send(String.fromCharCode(0x00, 0x0C, 0x00, 0x06, number >> 8, number & 0xFF)); } // Set Terminal display
    obj.intToStr = function (x) { return String.fromCharCode((x >> 24) & 0xFF, (x >> 16) & 0xFF, (x >> 8) & 0xFF, x & 0xFF); }
    obj.shortToStr = function (x) { return String.fromCharCode((x >> 8) & 0xFF, x & 0xFF); }

    obj.onResize = function () {
        if (obj.ScreenWidth == 0 || obj.ScreenHeight == 0) return;
        if (obj.Canvas.canvas.width == obj.ScreenWidth && obj.Canvas.canvas.height == obj.ScreenHeight) return;
        if (obj.FirstDraw) {
            obj.Canvas.canvas.width = obj.ScreenWidth;
            obj.Canvas.canvas.height = obj.ScreenHeight;
            obj.Canvas.fillRect(0, 0, obj.ScreenWidth, obj.ScreenHeight);
            if (obj.onScreenResize != null) obj.onScreenResize(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId);
        }
        obj.FirstDraw = false;
        //obj.Debug("onResize: " + obj.ScreenWidth + " x " + obj.ScreenHeight);
    }

    obj.xxMouseInputGrab = false;
    obj.xxKeyInputGrab = false;
    obj.xxMouseMove = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.NONE, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxMouseUp = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.UP, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxMouseDown = function (e) { if (obj.State == 3) obj.SendMouseMsg(obj.KeyAction.DOWN, e); if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxDOMMouseScroll = function (e) { if (obj.State == 3) { obj.SendMouseMsg(obj.KeyAction.SCROLL, e); return false; } return true; }
    obj.xxMouseWheel = function (e) { if (obj.State == 3) { obj.SendMouseMsg(obj.KeyAction.SCROLL, e); return false; } return true; }
    obj.xxKeyUp = function (e) { if (obj.State == 3) { obj.SendKeyMsg(obj.KeyAction.UP, e); } if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxKeyDown = function (e) { if (obj.State == 3) { obj.SendKeyMsg(obj.KeyAction.DOWN, e); } if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }
    obj.xxKeyPress = function (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }

    // Key handlers
    obj.handleKeys = function (e) { return obj.xxKeyPress(e); }
    obj.handleKeyUp = function (e) { return obj.xxKeyUp(e); }
    obj.handleKeyDown = function (e) { return obj.xxKeyDown(e); }

    // Mouse handlers
    obj.mousedown = function (e) { return obj.xxMouseDown(e); }
    obj.mouseup = function (e) { return obj.xxMouseUp(e); }
    obj.mousemove = function (e) { return obj.xxMouseMove(e); }
    obj.mousewheel = function (e) { return obj.xxMouseWheel(e); }

    obj.xxMsTouchEvent = function (evt) {
        if (evt.originalEvent.pointerType == 4) return; // If this is a mouse pointer, ignore this event. Touch & pen are ok.
        if (evt.preventDefault) evt.preventDefault();
        if (evt.stopPropagation) evt.stopPropagation();
        if (evt.type == 'MSPointerDown' || evt.type == 'MSPointerMove' || evt.type == 'MSPointerUp') {
            var flags = 0;
            var id = evt.originalEvent.pointerId % 256;
            var X = evt.offsetX * (Canvas.canvas.width / obj.CanvasId.clientWidth);
            var Y = evt.offsetY * (Canvas.canvas.height / obj.CanvasId.clientHeight);

            if (evt.type == 'MSPointerDown') flags = 0x00010000 | 0x00000002 | 0x00000004; // POINTER_FLAG_DOWN
            else if (evt.type == 'MSPointerMove') {
                //if (obj.TouchArray[id] && MuchTheSame(obj.TouchArray[id].x, X) && MuchTheSame(obj.TouchArray[id].y, Y)) return;
                flags = 0x00020000 | 0x00000002 | 0x00000004; // POINTER_FLAG_UPDATE
            }
            else if (evt.type == 'MSPointerUp') flags = 0x00040000; // POINTER_FLAG_UP

            if (!obj.TouchArray[id]) obj.TouchArray[id] = { x: X, y : Y };
            obj.SendTouchMsg2(id, flags)
            if (evt.type == 'MSPointerUp') delete obj.TouchArray[id];
        } else {
            alert(evt.type);
        }
        return true;
    }

    obj.xxTouchStart = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            var t = e.originalEvent.touches[0];
            e.which = 1;
            obj.LastX = e.pageX = t.pageX;
            obj.LastY = e.pageY = t.pageY;
            obj.SendMouseMsg(KeyAction.DOWN, e);
        } else {
            var Offsets = obj.GetPositionOfControl(Canvas.canvas);
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (!obj.TouchArray[id]) { obj.TouchArray[id] = { x: (e.originalEvent.touches[i].pageX - Offsets[0]) * (Canvas.canvas.width / obj.CanvasId.clientWidth), y: (e.originalEvent.touches[i].pageY - Offsets[1]) * (Canvas.canvas.height / obj.CanvasId.clientHeight), f: 1 }; }
            }
            if (Object.keys(obj.TouchArray).length > 0 && touchtimer == null) { obj.touchtimer = setInterval(function () { obj.SendTouchMsg2(256, 0); }, 50); }
        }
    }

    obj.xxTouchMove = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            var t = e.originalEvent.touches[0];
            e.which = 1;
            obj.LastX = e.pageX = t.pageX;
            obj.LastY = e.pageY = t.pageY;
            obj.SendMouseMsg(obj.KeyAction.NONE, e);
        } else {
            var Offsets = obj.GetPositionOfControl(Canvas.canvas);
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (obj.TouchArray[id]) {
                    obj.TouchArray[id].x = (e.originalEvent.touches[i].pageX - Offsets[0]) * (obj.Canvas.canvas.width / obj.CanvasId.clientWidth);
                    obj.TouchArray[id].y = (e.originalEvent.touches[i].pageY - Offsets[1]) * (obj.Canvas.canvas.height / obj.CanvasId.clientHeight);
                }
            }
        }
    }

    obj.xxTouchEnd = function (e) {
        if (obj.State != 3) return;
        if (e.preventDefault) e.preventDefault();
        if (obj.touchenabled == 0 || obj.touchenabled == 1) {
            if (e.originalEvent.touches.length > 1) return;
            e.which = 1;
            e.pageX = LastX;
            e.pageY = LastY;
            obj.SendMouseMsg(KeyAction.UP, e);
        } else {
            for (var i in e.originalEvent.changedTouches) {
                if (!e.originalEvent.changedTouches[i].identifier) continue;
                var id = e.originalEvent.changedTouches[i].identifier % 256;
                if (obj.TouchArray[id]) obj.TouchArray[id].f = 2;
            }
        }
    }

    obj.GrabMouseInput = function () {
        if (obj.xxMouseInputGrab == true) return;
        var c = obj.CanvasId;
        c.onmousemove = obj.xxMouseMove;
        c.onmouseup = obj.xxMouseUp;
        c.onmousedown = obj.xxMouseDown;
        c.touchstart = obj.xxTouchStart;
        c.touchmove = obj.xxTouchMove;
        c.touchend = obj.xxTouchEnd;
        c.MSPointerDown = obj.xxMsTouchEvent;
        c.MSPointerMove = obj.xxMsTouchEvent;
        c.MSPointerUp = obj.xxMsTouchEvent;
        if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = obj.xxDOMMouseScroll; else c.onmousewheel = obj.xxMouseWheel;
        obj.xxMouseInputGrab = true;
    }

    obj.UnGrabMouseInput = function () {
        if (obj.xxMouseInputGrab == false) return;
        var c = obj.CanvasId;
        c.onmousemove = null;
        c.onmouseup = null;
        c.onmousedown = null;
        c.touchstart = null;
        c.touchmove = null;
        c.touchend = null;
        c.MSPointerDown = null;
        c.MSPointerMove = null;
        c.MSPointerUp = null;
        if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = null; else c.onmousewheel = null;
        obj.xxMouseInputGrab = false;
    }

    obj.GrabKeyInput = function () {
        if (obj.xxKeyInputGrab == true) return;
        document.onkeyup = obj.xxKeyUp;
        document.onkeydown = obj.xxKeyDown;
        document.onkeypress = obj.xxKeyPress;
        obj.xxKeyInputGrab = true;
    }

    obj.UnGrabKeyInput = function () {
        if (obj.xxKeyInputGrab == false) return;
        document.onkeyup = null;
        document.onkeydown = null;
        document.onkeypress = null;
        obj.xxKeyInputGrab = false;
    }

    obj.GetPositionOfControl = function (Control) {
        var Position = Array(2);
        Position[0] = Position[1] = 0;
        while (Control) { Position[0] += Control.offsetLeft; Position[1] += Control.offsetTop; Control = Control.offsetParent; }
        return Position;
    }

    obj.crotX = function (x, y) {
        if (obj.rotation == 0) return x;
        if (obj.rotation == 1) return y;
        if (obj.rotation == 2) return obj.Canvas.canvas.width - x;
        if (obj.rotation == 3) return obj.Canvas.canvas.height - y;
    }

    obj.crotY = function (x, y) {
        if (obj.rotation == 0) return y;
        if (obj.rotation == 1) return obj.Canvas.canvas.width - x;
        if (obj.rotation == 2) return obj.Canvas.canvas.height - y;
        if (obj.rotation == 3) return x;
    }

    obj.rotX = function (x, y) {
        if (obj.rotation == 0 || obj.rotation == 1) return x;
        if (obj.rotation == 2) return x - obj.Canvas.canvas.width;
        if (obj.rotation == 3) return x - obj.Canvas.canvas.height;
    }

    obj.rotY = function (x, y) {
        if (obj.rotation == 0 || obj.rotation == 3) return y;
        if (obj.rotation == 1) return y - obj.Canvas.canvas.width;
        if (obj.rotation == 2) return y - obj.Canvas.canvas.height;
    }

    obj.tcanvas = null;
    obj.setRotation = function (x) {
        while (x < 0) { x += 4; }
        var newrotation = x % 4;
        if (newrotation == obj.rotation) return true;
        var rw = obj.Canvas.canvas.width;
        var rh = obj.Canvas.canvas.height;
        if (obj.rotation == 1 || obj.rotation == 3) { rw = obj.Canvas.canvas.height; rh = obj.Canvas.canvas.width; }

        // Copy the canvas, put it back in the correct direction
        if (obj.tcanvas == null) obj.tcanvas = document.createElement('canvas');
        var tcanvasctx = obj.tcanvas.getContext('2d');
        tcanvasctx.setTransform(1, 0, 0, 1, 0, 0);
        tcanvasctx.canvas.width = rw;
        tcanvasctx.canvas.height = rh;
        tcanvasctx.rotate((obj.rotation * -90) * Math.PI / 180);
        if (obj.rotation == 0) tcanvasctx.drawImage(obj.Canvas.canvas, 0, 0);
        if (obj.rotation == 1) tcanvasctx.drawImage(obj.Canvas.canvas, -obj.Canvas.canvas.width, 0);
        if (obj.rotation == 2) tcanvasctx.drawImage(obj.Canvas.canvas, -obj.Canvas.canvas.width, -obj.Canvas.canvas.height);
        if (obj.rotation == 3) tcanvasctx.drawImage(obj.Canvas.canvas, 0, -obj.Canvas.canvas.height);

        // Change the size and orientation and copy the canvas back into the rotation
        if (obj.rotation == 0 || obj.rotation == 2) { obj.Canvas.canvas.height = rw; obj.Canvas.canvas.width = rh; }
        if (obj.rotation == 1 || obj.rotation == 3) { obj.Canvas.canvas.height = rh; obj.Canvas.canvas.width = rw; }
        obj.Canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.Canvas.rotate((newrotation * 90) * Math.PI / 180);
        obj.rotation = newrotation;
        obj.Canvas.drawImage(obj.tcanvas, obj.rotX(0, 0), obj.rotY(0, 0));

        obj.ScreenWidth = obj.Canvas.canvas.width;
        obj.ScreenHeight = obj.Canvas.canvas.height;
        if (obj.onScreenResize != null) obj.onScreenResize(obj, obj.ScreenWidth, obj.ScreenHeight, obj.CanvasId);
        return true;
    }

    // Private method
    obj.MuchTheSame = function (a, b) { return (Math.abs(a - b) < 4); }
    obj.Debug = function (msg) { console.log(msg); }
    obj.getIEVersion = function () { var r = -1; if (navigator.appName == 'Microsoft Internet Explorer') { var ua = navigator.userAgent; var re = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})"); if (re.exec(ua) != null) r = parseFloat(RegExp.$1); } return r; }
    obj.haltEvent = function (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }

    return obj;
}
