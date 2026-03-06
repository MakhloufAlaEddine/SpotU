import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { Colors } from '../constants/Colors';

// WebView only on native
let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  color: string;
  type?: string;
  label?: string;  // Texte affiché dans le marqueur pill (style Airbnb)
}

interface Props {
  pins?: MapPin[];
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  searchRadius?: number;
  precisionRadius?: number;  // Circle around selected point for precision visualization
  selectable?: boolean;
  showUserMarker?: boolean;
  onPinPress?: (id: string) => void;
  onMapPress?: (lat: number, lng: number) => void;
  selectedLat?: number;
  selectedLng?: number;
  style?: object;
}

function buildHTML(p: {
  lat: number; lng: number; zoom: number;
  pins: MapPin[]; radius?: number;
  selectable: boolean; showUser: boolean;
  selLat?: number; selLng?: number;
  precisionRadius?: number;  // Circle around selected point
}): string {
  const cfg = JSON.stringify(p);
  return `<!DOCTYPE html><html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#f0f0f0;}
#map{width:100%;height:100%;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var CFG = ${cfg};
var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([CFG.lat,CFG.lng],CFG.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
function msg(d){
  var s=JSON.stringify(d);
  if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(s);}
  else{try{window.parent.postMessage(s,'*');}catch(e){}}
}
function mkPin(color){
  return L.divIcon({
    html:'<div style="width:28px;height:36px"><svg viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="'+color+'" stroke="white" stroke-width="2.5"/><circle cx="14" cy="14" r="5" fill="white"/></svg></div>',
    iconSize:[28,36],iconAnchor:[14,36],popupAnchor:[0,-36],className:''
  });
}
function mkPill(label,color,selected){
  var bg=selected?color:'#fff';
  var fg=selected?'#fff':color;
  var bw=selected?0:1.5;
  var fs=Math.min(13,Math.max(10,Math.floor(120/Math.max(label.length,1))));
  var w=Math.max(64,label.length*fs*0.6+20);
  return L.divIcon({
    html:'<div style="display:inline-flex;align-items:center;justify-content:center;background:'+bg+';color:'+fg+';border:'+bw+'px solid '+color+';border-radius:20px;padding:5px 10px;font-size:'+fs+'px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.18);min-width:'+w+'px;max-width:130px;overflow:hidden;text-overflow:ellipsis">'+label+'</div>',
    iconSize:[w,28],iconAnchor:[w/2,14],className:''
  });
}
var userIcon=L.divIcon({
  html:'<div style="width:20px;height:20px;background:#007AFF;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(0,122,255,0.25)"></div>',
  iconSize:[20,20],iconAnchor:[10,10],className:''
});
if(CFG.showUser){L.marker([CFG.lat,CFG.lng],{icon:userIcon}).addTo(map);}
var markers={};
CFG.pins.forEach(function(p){
  var icon=p.label?mkPill(p.label,p.color,false):mkPin(p.color);
  var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
  markers[p.id]=m;
  if(!p.label){m.bindPopup('<b>'+p.title+'</b>',{maxWidth:200,closeButton:false});}
  m.on('click',function(){
    if(p.label){
      // Reset all pills to unselected
      CFG.pins.forEach(function(q){
        if(q.label && markers[q.id]){markers[q.id].setIcon(mkPill(q.label,q.color,false));}
      });
      m.setIcon(mkPill(p.label,p.color,true));
    }
    msg({type:'pin',id:p.id});
  });
});
if(CFG.radius){
  L.circle([CFG.lat,CFG.lng],{radius:CFG.radius,color:'#1DBF73',fillColor:'#1DBF73',fillOpacity:0.06,weight:1.5,dashArray:'6,4'}).addTo(map);
}

// Precision circle for selected point
var precisionCircle=null;
var selMarker=null;

function updatePrecisionCircle(lat,lng){
  if(precisionCircle){map.removeLayer(precisionCircle);}
  if(selMarker){map.removeLayer(selMarker);selMarker=null;}
  
  if(CFG.precisionRadius && CFG.precisionRadius > 0){
    // Only show circle, no marker for Moyen/Faible precision
    precisionCircle=L.circle([lat,lng],{
      radius:CFG.precisionRadius,
      color:'#FF3B30',
      fillColor:'#FF3B30',
      fillOpacity:0.25,
      weight:3
    }).addTo(map);
    map.fitBounds(precisionCircle.getBounds(), {padding: [20, 20]});
  } else {
    // Show marker only for exact precision (no circle)
    selMarker=L.marker([lat,lng],{icon:mkPin('#FF3B30')}).addTo(map);
  }
}

// Draw initial marker/circle based on precision
if(CFG.selLat && CFG.selLng){
  updatePrecisionCircle(CFG.selLat,CFG.selLng);
}

if(CFG.selectable){
  map.on('click',function(e){
    msg({type:'press',lat:e.latlng.lat,lng:e.latlng.lng});
    updatePrecisionCircle(e.latlng.lat,e.latlng.lng);
  });
}
</script>
</body></html>`;
}

export function MapViewComponent({
  pins = [], centerLat = 48.8566, centerLng = 2.3522, zoom = 13,
  searchRadius, precisionRadius, selectable = false, showUserMarker = false,
  onPinPress, onMapPress, selectedLat, selectedLng, style,
}: Props) {
  const ref = useRef<any>(null);
  const iframeRef = useRef<any>(null);

  const html = buildHTML({
    lat: centerLat, lng: centerLng, zoom,
    pins, radius: searchRadius, precisionRadius,
    selectable, showUser: showUserMarker,
    selLat: selectedLat, selLng: selectedLng,
  });

  const handleMessage = useCallback((data: any) => {
    if (data.type === 'pin') onPinPress?.(data.id);
    if (data.type === 'press') onMapPress?.(data.lat, data.lng);
  }, [onPinPress, onMapPress]);

  // Web: listen to iframe messages
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch {}
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handleMessage]);

  const onMessage = useCallback((e: any) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      handleMessage(data);
    } catch {}
  }, [handleMessage]);

  if (Platform.OS === 'web') {
    // Key based on precision only to reload when precision changes
    const iframeKey = `map-${precisionRadius}`;
    return (
      <View style={[styles.container, style]}>
        <iframe
          key={iframeKey}
          ref={iframeRef}
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 'none' } as any}
          title="WINEK Map"
          sandbox="allow-scripts allow-same-origin"
        />
      </View>
    );
  }

  if (!WebView) {
    return (
      <View style={[styles.container, style, styles.loading]}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Chargement carte…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={ref}
        source={{ html }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingText}>Chargement…</Text>
          </View>
        )}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  map: { flex: 1, backgroundColor: '#f0f4f0' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#f0f4f0' },
  loadingText: { color: Colors.muted, fontSize: 14 },
});
