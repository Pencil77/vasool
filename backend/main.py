from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
import models
import schemas
from database import engine, get_db
from passlib.context import CryptContext
import random
import string

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

# Create the database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vasool API", description="Centralized Hostel Expense Manager")


@app.get("/")
def read_root():
    return {"message": "Welcome to the Vasool API!"}


@app.post("/auth/signup")
def signup(user: schemas.UserSignup, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = get_password_hash(user.password)
    verification_code = "".join(random.choices(string.digits, k=6))
    
    db_user = models.User(
        email=user.email,
        name=user.name,
        hashed_password=hashed_pwd,
        is_verified=False,
        verification_code=verification_code
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    print(f"Verification code for {user.email}: {verification_code}")
    return {"message": "User created. Check terminal for verification code."}


@app.post("/auth/verify")
def verify(user: schemas.UserVerify, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.verification_code != user.code:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    db_user.is_verified = True
    db_user.verification_code = None
    db.commit()
    return {"message": "Email verified successfully"}


@app.post("/auth/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not db_user.is_verified:
        raise HTTPException(status_code=403, detail="Email not verified")
    
    # Mock JWT Token
    return {"access_token": "mock-jwt-token-12345", "token_type": "bearer"}


@app.post("/users/", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    fake_hashed_password = user.password + "notreallyhashed"
    db_user = models.User(
        email=user.email, hashed_password=fake_hashed_password, name=user.name
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.post("/gangs/", response_model=schemas.GangResponse)
def create_gang(gang: schemas.GangCreate, user_id: int, db: Session = Depends(get_db)):
    db_gang = models.Gang(name=gang.name, leader_id=user_id)
    db.add(db_gang)
    db.commit()
    db.refresh(db_gang)

    participant = models.GangParticipant(
        gang_id=db_gang.id,
        user_id=user_id,
        role=models.RoleEnum.LEADER.value,
        status=models.StatusEnum.ACCEPTED.value,
    )
    db.add(participant)
    db.commit()
    return db_gang


@app.post(
    "/gangs/{gang_id}/participants/", response_model=schemas.GangParticipantResponse
)
def add_gang_participant(
    gang_id: int,
    participant: schemas.GangParticipantCreate,
    db: Session = Depends(get_db),
):
    db_participant = models.GangParticipant(
        gang_id=gang_id,
        user_id=participant.user_id,
        display_name=participant.display_name,
        role=participant.role.value,
        status=participant.status.value,
        delegated_to_id=participant.delegated_to_id,
    )
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant


@app.post("/gangs/{gang_id}/expenses/", response_model=schemas.ExpenseResponse)
def create_expense(
    gang_id: int, expense: schemas.ExpenseCreate, db: Session = Depends(get_db)
):
    db_expense = models.Expense(
        gang_id=gang_id,
        description=expense.description,
        total_amount=expense.total_amount,
        paid_by_id=expense.paid_by_id,
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)

    for split in expense.splits:
        db_split = models.ExpenseSplit(
            expense_id=db_expense.id,
            participant_id=split.participant_id,
            amount_owed=split.amount_owed,
        )
        db.add(db_split)
    db.commit()
    db.refresh(db_expense)
    return db_expense
