package com.spotu.modules.chat.ws;

import org.springframework.web.socket.CloseStatus;

public final class WsCloseCodes {
    public static final CloseStatus AUTH_FAIL = new CloseStatus(4001, "AUTH_FAIL");
    public static final CloseStatus PERMISSION_DENIED = new CloseStatus(4003, "PERMISSION_DENIED");
    public static final CloseStatus MESSAGE_TOO_LARGE = new CloseStatus(4009, "MESSAGE_TOO_LARGE");

    private WsCloseCodes() {
    }
}
