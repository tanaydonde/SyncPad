package main

import(
	"encoding/json"
	"github.com/gorilla/websocket"
)

type Hub struct {
	clients map[*websocket.Conn]bool
	register chan *websocket.Conn
	unregister chan *websocket.Conn
	broadcast chan string
	currentText string
	users int
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
		register: make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
		broadcast: make(chan string),
		currentText: "",
		users: 0,
	}
}

type DocMsg struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type PresenceMsg struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
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
			_ = h.sendJSON(conn, DocMsg{Type: "doc", Text: h.currentText})
			h.broadcastPresence()
		
		case conn := <- h.unregister:
			if h.clients[conn]{
				delete(h.clients, conn)
				conn.Close()
				h.users--
				h.broadcastPresence()
			}
		
		case msg := <- h.broadcast:
			h.currentText = msg
			h.broadcastJSON(DocMsg{Type: "doc", Text: h.currentText})
		}
	}
}