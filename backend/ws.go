package main

import (
	"encoding/json"
	//"fmt"
	"net/http"
	"github.com/gorilla/websocket"
)

type EditMsg struct {
	Type string `json:"type"`

	ClientID string `json:"clientId"`

	State string `json:"state,omitempty"`
	Update string `json:"update,omitempty"`
	
	Start string `json:"start,omitempty"`
	End string `json:"end,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {return true},
}

func wsHandler(w http.ResponseWriter, r *http.Request){
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		//fmt.Println("upgrade error:", err)
		return
	}

	room := r.URL.Query().Get("room")
	if room == "" {
		room = "default"
	}

	hub := getRoomHub(room)

	//fmt.Println("ws client connected to room:", room)
	hub.register <- conn

	defer func() { hub.unregister <- conn}()

	for {
		_, msg, err := conn.ReadMessage()

		if err != nil {
			//fmt.Println("read error:", err)
			return
		}

		var em EditMsg
		if err := json.Unmarshal(msg, &em); err != nil {
			continue
		}

		switch(em.Type){
		
		case("y_update"):
			hub.yUpdate <- YUpdateEvent{ClientID: em.ClientID, Update: em.Update}
		
		case ("y_state"):
			hub.yState <- YStateEvent{State: em.State}
		
		case("cursor"):
			hub.cursor <- CursorEvent{ClientID: em.ClientID, Start: em.Start, End: em.End}
		
		}
		
	}
}