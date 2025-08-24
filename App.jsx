import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'
const POLL_MS = Number(import.meta.env.VITE_POLL_MS || 5000)

function Row({children}) {
  return <div style={{border:'1px solid #ddd', padding:8, margin:'8px 0', borderRadius:8}}>{children}</div>
}

export default function App(){
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(1)
  const [followers, setFollowers] = useState({ followerId:'', followedId:'' })
  const [post, setPost] = useState({ userId: 1, content: '' })
  const [like, setLike] = useState({ userId: 2, postId: '' })
  const [comment, setComment] = useState({ userId: 3, postId: '', content: '' })
  const [discover, setDiscover] = useState({ viewerId: 2, postId: '' })
  const [notifs, setNotifs] = useState([])
  const latestIdRef = useRef(0)

  useEffect(() => {
    axios.get(`${API_BASE}/users`).then(r => {
      setUsers(r.data)
      if (r.data?.length) {
        setSelectedUser(r.data[0].id)
        setPost(p => ({...p, userId: r.data[0].id}))
      }
    })
  }, [])

  // Polling notifications
  useEffect(() => {
    let timer
    const poll = async () => {
      try {
        const url = latestIdRef.current
          ? `${API_BASE}/notifications?userId=${selectedUser}&sinceId=${latestIdRef.current}`
          : `${API_BASE}/notifications?userId=${selectedUser}`
        const res = await axios.get(url)
        if (res.data?.length) {
          setNotifs(prev => {
            const merged = [...res.data, ...prev]
            latestIdRef.current = Math.max(latestIdRef.current, ...res.data.map(n => n.id))
            return merged
          })
        }
      } catch(e) {
        // ignore for POC
      }
      timer = setTimeout(poll, POLL_MS)
    }
    if (selectedUser) {
      latestIdRef.current = 0
      setNotifs([])
      poll()
    }
    return () => clearTimeout(timer)
  }, [selectedUser])

  return (
    <div style={{maxWidth:900, margin:'0 auto', padding:16, fontFamily:'system-ui, sans-serif'}}>
      <h2>Insyd Notification POC</h2>
      <p style={{opacity:.8}}>Lightweight front-end to drive the backend and view in-app notifications. No auth, minimal styling.</p>

      <Row>
        <strong>Current User (recipient)</strong><br/>
        <select value={selectedUser} onChange={e => setSelectedUser(Number(e.target.value))}>
          {users.map(u => <option key={u.id} value={u.id}>{u.id} — {u.name}</option>)}
        </select>
      </Row>

      <Row>
        <strong>Create/Follow</strong>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <div><em>Create User</em></div>
            <CreateUser onCreate={u => setUsers(prev => [...prev, u])} />
          </div>
          <div>
            <div><em>Follow</em></div>
            <Form onSubmit={async () => {
              await axios.post(`${API_BASE}/follow`, followers)
              alert('Followed!')
            }}>
              <input placeholder="followerId" value={followers.followerId} onChange={e=>setFollowers({...followers, followerId:Number(e.target.value)})}/>
              <input placeholder="followedId" value={followers.followedId} onChange={e=>setFollowers({...followers, followedId:Number(e.target.value)})}/>
              <button>Follow</button>
            </Form>
          </div>
        </div>
      </Row>

      <Row>
        <strong>Create Post</strong>
        <Form onSubmit={async () => {
          const r = await axios.post(`${API_BASE}/posts`, post)
          alert(`Post ${r.data.id} created`)
        }}>
          <select value={post.userId} onChange={e=>setPost({...post, userId:Number(e.target.value)})}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input placeholder="content" value={post.content} onChange={e=>setPost({...post, content:e.target.value})}/>
          <button>Post</button>
        </Form>
      </Row>

      <Row>
        <strong>Engagement</strong>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <Form onSubmit={async () => {
            await axios.post(`${API_BASE}/likes`, like); alert('Liked')
          }}>
            <input placeholder="userId (who likes)" value={like.userId} onChange={e=>setLike({...like, userId:Number(e.target.value)})}/>
            <input placeholder="postId" value={like.postId} onChange={e=>setLike({...like, postId:Number(e.target.value)})}/>
            <button>Like</button>
          </Form>
          <Form onSubmit={async () => {
            await axios.post(`${API_BASE}/comments`, comment); alert('Commented')
          }}>
            <input placeholder="userId (who comments)" value={comment.userId} onChange={e=>setComment({...comment, userId:Number(e.target.value)})}/>
            <input placeholder="postId" value={comment.postId} onChange={e=>setComment({...comment, postId:Number(e.target.value)})}/>
            <input placeholder="content" value={comment.content} onChange={e=>setComment({...comment, content:e.target.value})}/>
            <button>Comment</button>
          </Form>
        </div>
      </Row>

      <Row>
        <strong>Discovery</strong>
        <Form onSubmit={async () => { await axios.post(`${API_BASE}/discover`, discover); alert('Discovery recorded') }}>
          <input placeholder="viewerId" value={discover.viewerId} onChange={e=>setDiscover({...discover, viewerId:Number(e.target.value)})}/>
          <input placeholder="postId" value={discover.postId} onChange={e=>setDiscover({...discover, postId:Number(e.target.value)})}/>
          <button>Record Discovery</button>
        </Form>
      </Row>

      <Row>
        <strong>Notifications for user #{selectedUser}</strong>
        <div>
          {notifs.length === 0 && <div>No notifications yet.</div>}
          {notifs.map(n => (
            <div key={n.id} style={{padding:8, borderBottom:'1px solid #eee'}}>
              <div style={{fontSize:14}}>{n.message}</div>
              <div style={{fontSize:12, opacity:.6}}>{n.verb} • {n.entity_type} • id {n.id}</div>
            </div>
          ))}
        </div>
      </Row>
    </div>
  )
}

function Form({children, onSubmit}){
  return (
    <form onSubmit={e=>{e.preventDefault(); onSubmit()}} style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
      {children}
    </form>
  )
}

function CreateUser({onCreate}){
  const [name, setName] = useState('')
  return (
    <Form onSubmit={async ()=>{
      const r = await axios.post(`${API_BASE}/users`, {name})
      onCreate(r.data)
      setName('')
    }}>
      <input placeholder="name" value={name} onChange={e=>setName(e.target.value)}/>
      <button>Create</button>
    </Form>
  )
}