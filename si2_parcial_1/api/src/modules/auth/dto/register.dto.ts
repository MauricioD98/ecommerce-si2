import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength, minLength } from "class-validator";

export class RegisterDto {

    @ApiProperty({
            description:'User email address',
            example:'john.doe@example.com',
        })
    @IsEmail({},{message: "Por favor ingrese un correo electrónico válido"})
    @IsNotEmpty({message: "El correo electrónico es obligatorio"})
    email: string;

    @ApiProperty({
        description: 'User password',
        example: 'StrongP@ssw0rd!',
    })
    @IsString()
    @IsNotEmpty({message: "La contraseña es obligatoria"})
    @MinLength(8, {message: "La contraseña debe tener al menos 8 caracteres"})
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {message: "La contraseña debe contener al menos una letra mayúscula, una letra minúscula, un número y un carácter especial"})
    password: string;
   
    @ApiProperty({
        description:'User first name',
        example:'John',
        required:false,
    })
    @IsOptional()
    @IsString()
    firstName?: string;


    @ApiProperty({
        description:'User last name',
        example:'Doe',
        required:false,
    })
    @IsOptional()
    @IsString()
    lastName?: string;

    // Teléfono de contacto (opcional)
    @ApiProperty({
        description:'User phone number',
        example:'+591 70000000',
        required:false,
    })
    @IsOptional()
    @IsString()
    phone?: string;

}