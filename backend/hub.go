package main

import(
	//"fmt"
	"github.com/gorilla/websocket"
)

type Hub struct {
	clients map[*websocket.Conn]bool
	register chan *websocket.Conn
	unregister chan *websocket.Conn
	broadcast chan []byte
	currentText []byte
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
		register: make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
		broadcast: make(chan []byte),
		currentText: []byte(""),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case conn := <- h.register:
			h.clients[conn] = true
			if len(h.currentText) > 0 {
				if err := conn.WriteMessage(websocket.TextMessage, h.currentText); err != nil {
					delete(h.clients, conn)
					conn.Close()
				}
			}
		
		case conn := <- h.unregister:
			if h.clients[conn]{
				delete(h.clients, conn)
				conn.Close()
			}
		
		case msg := <- h.broadcast:

			h.currentText = msg

			for conn := range h.clients {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					delete(h.clients, conn)
					conn.Close()
				}
			}
		}
	}
}