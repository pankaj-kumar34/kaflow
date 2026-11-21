package main

import (
	"embed"
	"log"

	"kaflow/backend/connection"
	"kaflow/backend/models"
	"kaflow/backend/services"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[models.MessageEvent]("kaflow:message")
	application.RegisterEvent[models.UpdateProgress]("updater:progress")
	application.RegisterEvent[string]("nav:tab")
	application.RegisterEvent[string]("nav:toggle-sidebar")
	application.RegisterEvent[string]("nav:new-connection")
	application.RegisterEvent[string]("nav:shortcuts")
}

func main() {
	connMgr := connection.NewConnectionManager()
	connService := services.NewConnectionService(connMgr)
	topicService := services.NewTopicService(connMgr)
	messageService := services.NewMessageService(connMgr)
	groupService := services.NewGroupService(connMgr)
	diagService := services.NewDiagnosticsService(connMgr)
	tailService := services.NewTailService(connMgr)
	connMgr.OnDisconnect = func(id string) { _ = tailService.StopTail(id) }
	updaterService := services.NewUpdaterService()

	var app *application.App

	keyBindings := map[string]func(window application.Window){
		"cmdorctrl+1": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "topics")
			}
		},
		"cmdorctrl+2": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "groups")
			}
		},
		"cmdorctrl+3": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "cluster")
			}
		},
		"ctrl+1": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "topics")
			}
		},
		"ctrl+2": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "groups")
			}
		},
		"ctrl+3": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "cluster")
			}
		},
		"option+1": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "topics")
			}
		},
		"option+2": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "groups")
			}
		},
		"option+3": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:tab", "cluster")
			}
		},
		"cmdorctrl+b": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:toggle-sidebar", "")
			}
		},
		"ctrl+b": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:toggle-sidebar", "")
			}
		},
		"cmdorctrl+n": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:new-connection", "")
			}
		},
		"ctrl+n": func(window application.Window) {
			if app != nil {
				app.Event.Emit("nav:new-connection", "")
			}
		},
	}

	app = application.New(application.Options{
		Name:        "Kaflow",
		Description: "Native Desktop Client for Apache Kafka",
		Services: []application.Service{
			application.NewService(connService),
			application.NewService(topicService),
			application.NewService(messageService),
			application.NewService(groupService),
			application.NewService(diagService),
			application.NewService(tailService),
			application.NewService(updaterService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		KeyBindings: keyBindings,
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Kaflow",
		Width:  1280,
		Height: 800,
		Mac: application.MacWindow{
			Backdrop:   application.MacBackdropNormal,
			TitleBar:   application.MacTitleBarDefault,
			Appearance: application.NSAppearanceNameVibrantLight,
		},
		BackgroundColour: application.NewRGB(15, 23, 42),
		URL:              "/",
		KeyBindings:      keyBindings,
	})

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
