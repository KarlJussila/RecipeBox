'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface TimeInputProps {
  value?: number // minutes
  onChange?: (minutes: number | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function TimeInput({ value, onChange, placeholder = "00:00", className, disabled }: TimeInputProps) {
  const [timeString, setTimeString] = useState('')

  // Convert minutes to HH:MM string
  useEffect(() => {
    if (value !== undefined && value !== null) {
      const hours = Math.floor(value / 60)
      const minutes = value % 60
      setTimeString(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`)
    } else {
      setTimeString('')
    }
  }, [value])

  // Convert HH:MM string to minutes
  const parseTimeString = (timeStr: string): number | undefined => {
    if (!timeStr.trim()) return undefined
    
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return undefined
    
    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return undefined
    }
    
    return hours * 60 + minutes
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    setTimeString(input)
    
    const minutes = parseTimeString(input)
    onChange?.(minutes)
  }

  const handleBlur = () => {
    // Format the time string on blur
    const minutes = parseTimeString(timeString)
    if (minutes !== undefined) {
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      setTimeString(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`)
    }
  }

  return (
    <Input
      type="text"
      value={timeString}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={cn("w-20 text-center text-sm", className)}
      disabled={disabled}
      maxLength={5}
    />
  )
}

// Utility function to format minutes as HH:MM
export function formatCookTime(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null) return ''
  
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  
  if (h === 0) {
    return `${m}m`
  } else if (m === 0) {
    return `${h}h`
  } else {
    return `${h}h ${m}m`
  }
}