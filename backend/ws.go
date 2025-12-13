package main

import (
	"fmt"
	"net/http"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {return true},
}

func wsHandler(w http.ResponseWriter, r *http.Request){
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("upgrade error:", err)
		return
	}

	room := r.URL.Query().Get("room")
	if room == "" {
		room = "default"
	}

	hub := getRoomHub(room)

	fmt.Println("ws client connected to room:", room)
	hub.register <- conn

	for {
		_, msg, err := conn.ReadMessage()

		if err != nil {
			fmt.Println("read error:", err)
			hub.unregister <- conn
			return
		}

		hub.broadcast <- msg
	}
}