package main

import(
	"encoding/json"
	"github.com/gorilla/websocket"
)

type YUpdateEvent struct {
	ClientID string
	Update string
}

type YStateEvent struct {
	State string
}

type CursorEvent struct {
	ClientID string
	Start int
	End int
}

type Hub struct {
	clients map[*websocket.Conn]bool

	register chan *websocket.Conn
	unregister chan *websocket.Conn

	yUpdate chan YUpdateEvent
	yState chan YStateEvent

	cursor chan CursorEvent
	
	currentYState string

	users int
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),

		register: make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),

		yUpdate: make(chan YUpdateEvent),
		yState: make(chan YStateEvent),

		cursor: make(chan CursorEvent),

		currentYState: "",

		users: 0,
	}
}

type PresenceMsg struct {
	Type string `json:"type"`
	Count int `json:"count"`
}

type CursorMsg struct {
	Type string `json:"type"`
	ClientID string `json:"clientId"`
	Start int `json:"start"`
	End int `json:"end"`
}

type CursorRequestMsg struct {
	Type string `json:"type"`
	From string `json:"from"`
}

type YUpdateMsg struct {
	Type string `json:"type"`
	ClientID string `json:"clientId"`
	Update string `json:"update"`
}

type YSyncMsg struct {
	Type string `json:"type"`
	State string `json:"state,omitempty"`
}


func (h *Hub) sendJSON(conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, b)
}

func (h *Hub) broadcastJSON(v any)  {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}

	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			delete(h.clients, conn)
			conn.Close()
		}
	}
}

func (h *Hub) broadcastPresence() {
	h.broadcastJSON(PresenceMsg{Type: "presence", Count: h.users})
}

func (h *Hub) Run() {
	for {
		select {
		case conn := <- h.register:
			h.clients[conn] = true
			h.users++
			_ = h.sendJSON(conn, YSyncMsg{Type: "y_sync", State: h.currentYState})
			h.broadcastPresence()
		
		case conn := <- h.unregister:
			if h.clients[conn]{
				delete(h.clients, conn)
				conn.Close()
				h.users--
				h.broadcastPresence()
			}

		case update := <- h.yUpdate:
			h.broadcastJSON(YUpdateMsg{Type: "y_update", ClientID: update.ClientID, Update: update.Update})

		case state := <- h.yState:
			h.currentYState = state.State

		case c := <- h.cursor:
			h.broadcastJSON(CursorMsg{Type: "cursor", ClientID: c.ClientID, Start: c.Start, End:c.End})

		}
	}
}