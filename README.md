# RTView-Cumulocity Project
Software AG Cumulocity - IoT Device Management

## Overview
This project provides tools and examples that show how to use RTView Cloud with the Software AG Cumulocity IoT Device Management Platform to readily create and deploy rich graphical displays connected to real-time and historical Cumulocity data. 

![](Images/MixingPlantA.jpg)

By following the steps described below you will:

* Create an account on RTView Cloud.
* Run a Node.js connector program that enables access to Cumulocity device and event data from RTView Cloud.
* Import into RTView Cloud a few sample displays showing real-time data coming from ATT-IoT.

## Requirements
To run this project, you will need to have installed on your computer:
```
Node.js version 6 or higher
```
## Create an RTView Cloud account
An RTView Cloud account provides the tools for creating, viewing and publishing rich graphical displays connected to real-time data sources.

* In a browser, go to [RTView Cloud](http://rtviewcloud.sl.com/).
* Click on Start Free Trial to create your account (skip if you have an account already).
* Login to your RTView Cloud account.

Note that you are automatically placed into your own private organization (e.g. JohnSPrivateOrg).
	
## Run the RTView Cumulocity connector 

Clone this RTView-Cumulocity project to your local computer and follow the steps below to install and run the RTView Cumulocity connector program. This simple Node.js program provides access to public demo devices and events provided by Cumulocity, which provides current and historical caching of device metric values.

To install the connector program:
```
cd RTView-Cumulocity-Node

npm install
```
To start the program:
```
node cumulocity_connector.js
```
This connector program can easily be modified to subscribe to devices private to your own application.

## Import and view the sample RTView-Cumulocity displays

* In a browser, go to [RTView Cloud](http://rtviewcloud.sl.com/).

* Define a connection to the RTView DataServer running on your local system:
```
On the RTView Cloud top menu bar, select Data.
Select the Add RTView Server button.
In the Add RTView Server dialog enter:

	Name:       CUM-IOT-DATA
	Host/URL:   http://localhost:3270/rtvquery

Click on Save Added Servers.
```
* Test that the connection is successful:
```
Click on the green magnifying glass icon next to the CUM-IOT-DATA entry.
This will invoke the RTView DataServer - Cache Tables dialog.
Verify that you see "Connected" under Connection Status. 
Verify that you see CUM-IoTCache in the CacheTable.
Close the dialog.
```
* Import the sample displays:
```
On the RTView Cloud top menu bar, click on Design to invoke the RTDraw visual editing tool.
Select the File dropdown menu and click on Import... 
In the file browser, navigate to the RTView-CUM-IoT-Displays directory within this project.
Select all displays and click Open.
```
* View or edit the sample displays:
```
Select the File dropdown menu and click on Open...
Double click the name of the display you would like to open and view in real-time.
```
The sample displays are configured to connect to your local RTView data server and present data changing in real-time.
You can experiment with the editing features of RTDraw to make changes to these displays or create your own.

## Achieved Goals

In this RTView-Cumulocity project you will have achieved the following: 

* Seen how easy it is to display Cumulocity topics in graphical and highly configurable displays in the Cloud.
* Launched the simple node program used to send data to RTView, subscribing to topics of interest.
* Seen how users are able to view or enhance the sample RTView displays or create new displays.

**Feel free to experiment with, modify or enhance this project, and share your experience, comments and suggestions with us. Please fork this repo and submit a pull request for any changes you would like to suggest.**
